# 04 Tab5 feasibility

Series: [01 System design](01-system-design.md) · [02 Developer guide](02-developer-guide.md) · [03 UI brief](03-ui-brief.md) · **04 Tab5 feasibility** · [05 Code guide](05-code-guide.md) · [06 Research prompts](06-research-prompts.md)

The Chinese file is in [`docs/01-zh`](../01-zh/04-Tab5迁移可行性.md).

Assessment date: 2026-10-19  
Hardware target: M5Stack Tab5 Kit (SKU K145)  
Scope: read-only code and public documents. This note does not change application code, install dependencies, or create a firmware project.

The conclusion first: **conditional go.** Tab5 fits as a dedicated hardware client. The existing React / iPhone app stays as it is. The dialogue state machine stays the current XState implementation, running in the Node process for Tab5. Do not rewrite it on the ESP32-P4. The first prototype board is worth buying. Do not buy an LTE module now.

Three labels separate the evidence:

- **Verified:** a file or function in the repository, or an official document listed at the end.
- **Inferred:** an engineering judgment drawn from a verified fact, not yet run on this hardware.
- **Open:** a question that can be answered only after a K145 is plugged in.

---

## 1. Executive summary

The current system is "one state machine in the browser + one stateless Node backend on the Mac." Translation, clarification, confirmation, counters, and evaluation events are decided by `apps/web/src/dialogue/machine.ts`. The backend only provides ASR, interpretation, translation, TTS, and a metadata log. Tab5 (ESP32-P4 + ESP32-C6) cannot run React or Node, and it should not run Whisper or Ollama.

The workable approach is a new thin client:

1. Tab5 owns the screen, touch, recording, speaker, Wi-Fi, and retries.
2. The existing Node process hosts **the same** state machine again for this device. The browser copy stays as it is.
3. The device uploads 16 kHz mono PCM WAV. The backend keeps using `/api/asr`, `/api/interpret`, `/api/translate`, and `/api/tts`.
4. Playback is PCM. The Cloud preset returns MP3 today. That path must be converted to WAV on the server. Do not decode MP3 on the chip first.

Official material (sources in section 12) already has Tab5 examples for the screen, touch, microphone, speaker, and Wi-Fi. The microphone example states that **the microphone and the speaker cannot be used at the same time**. The example ring buffer is about 11 seconds at 17 kHz. The product limit is 30 seconds per segment (`LIMITS.segmentSeconds`). Five to fifteen seconds fits the board's memory, but the buffer must be a linear allocation. Do not copy that 11-second ring buffer as it is.

The main risk is not "can the chip compute." It is the display-driver revision, Wi-Fi on the C6 coprocessor, Chinese glyphs, Cloud MP3, and exposing today's unauthenticated API, which binds only `127.0.0.1`, onto the LAN.

---

## 2. Existing architecture

### 2.1 Layout and boundaries

The repository is npm workspaces (`package.json`):

| Path | Responsibility |
|---|---|
| `apps/web` | React 18 + Vite. Child UI, recording, playback, the state machine, evaluation events |
| `apps/server` | Express. Preset routing, Cloud / Local / Mock adapters, SQLite telemetry, `/monitor` |
| `packages/shared` | Types, Zod schemas, limits, and the evaluation-event schema shared by both sides |
| `tests/machine` | Drives the same state machine in Node (Vitest) |
| `docs/02-en/01-system-design.md` | The authoritative design |

The boundary between the browser and the backend is the three interfaces in `packages/shared/src/contracts.ts`: `SpeechRecognizer`, `DialogueModel`, and `SpeechSynthesizer`. The browser implements them over HTTP in `createApiBundle()` in `apps/web/src/services/apiClient.ts`. The server implements the same interfaces per preset under `apps/server/src/providers/`.

### 2.2 Frontend: who draws, who touches hardware

The composition root is `apps/web/src/services/runtime.ts`. It creates the one `dialogueMachine` and injects the recorder, the in-memory audio store, the player, the prompts, and the `EventLogger`.

The screen mapping is `screenOf()` in `apps/web/src/dialogue/selectors.ts`. `apps/web/src/ui/App.tsx` renders by that screen name. The screens themselves are in `apps/web/src/ui/screens.tsx`:

| Screen | Component | User action (machine event) |
|---|---|---|
| Home | `HomeScreen` | `START_TASK` (`ZH_TO_SV` / `SV_TO_ZH`) |
| Recording | `RecordingScreen` | `SKIP_PROMPT`, `STOP_SEGMENT`; the 30-second countdown comes from `useCountdown` |
| Continue or finished | `SegmentDecisionScreen` | `CONTINUE_SPEAKING`, `FINISH_INPUT` |
| Busy | `BusyScreen` | No buttons. `busyStage()` distinguishes asr / interpret / translate / tts |
| Clarify | `QuestionScreen kind="clarify"` | `START_ANSWER`, `RETRY` |
| Confirm | `QuestionScreen kind="confirm"` | `CONFIRM_YES`, `CONFIRM_NO`, `RETRY` |
| Result | `ResultScreen` | `DELIVERY_FINISHED`, `RETRY`, `START_TASK`, `NEW_TURN` |
| Switch direction | `SwitchScreen` | `SWITCH_YES`, `SWITCH_NO` |
| Error | `ErrorScreen` | `RETRY`, `CANCEL`. Copy includes `NETWORK` and `TIMEOUT` |
| Fallback | `FallbackScreen` | `RESTART`, `CANCEL` |
| Didn't hear | `AsrEmptyScreen` | `RETRY` |

The large button is `apps/web/src/ui/BigButton.tsx`. Its comment says the height is at least 64 px. `docs/01-zh/03-界面设计需求.md` requires primary buttons of at least 96 pt, with icons and color ahead of text. Those size constraints still apply to Tab5, but the current layout is iPhone portrait (390×844 / 375×667). The Tab5 panel is 1280×720 landscape. **The React layout cannot be moved across as it is.**

Adult-readable text (transcript, clarification budget, error category) lives in `AdultInfo` in `App.tsx` and in each screen's `adult-note`. The child's main path does not depend on reading.

Developer settings are in `apps/web/src/ui/DevPanel.tsx`. The preset is remembered in `localStorage` (`apps/web/src/services/presetPreference.ts`, key `kt.preset`). Tab5 does not need that panel, and it does not need `localStorage`.

### 2.3 Backend responsibilities and endpoints

Entry: `apps/server/src/index.ts`. Routes: `apps/server/src/app.ts` and `apps/server/src/monitor/routes.ts`.

Translation (no login):

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/health` | none | `{ ok, version, promptMemory, presets }` |
| POST | `/api/asr?language=zh\|sv` | raw audio bytes | `{ text }` |
| POST | `/api/interpret` | JSON, `InterpretRequestSchema` | `ASK_CLARIFICATION` / `PROPOSE_MEANING` / `UNRESOLVED` |
| POST | `/api/translate` | JSON `{ text, direction, previousDelivered? }` | `{ translation }` |
| POST | `/api/tts` | JSON `{ text, language }` | audio bytes, `Content-Type` is the adapter's `mimeType` |
| POST | `/api/events` | `{ events: EvalEvent[] }`, at most 100 | 204 |

Required headers: `X-Provider-Preset`, `X-Task-Id`, `X-Request-Id` (regex `^[A-Za-z0-9_.:-]{1,100}$`). Optional: `X-Session-Id`, `X-Direction`, `X-Duration-Ms`, `X-Mock-Transcript` (mock only).

Monitor routes are under `/api/monitor/*` and need an admin cookie. `/api/events` itself does not require login. Export and delete do.

The default listen address is `127.0.0.1:8787` (`HOST` in `apps/server/src/config.ts`). The iPhone does not connect to that port directly. It goes through Vite's HTTPS proxy (`apps/web/vite.config.ts` forwards `/api` to `127.0.0.1:8787`). There is no CORS middleware. The browser works because the page and `/api` are the same origin.

### 2.4 Where the dialogue machine lives

**The machine is in the browser, not in the backend.**

- Definition: `createDialogueMachine()`, `apps/web/src/dialogue/machine.ts` (XState v5).
- Context type: `MachineContext` in `apps/web/src/dialogue/types.ts`.
- Browser wiring: `runtime.ts`.
- Node tests already run it: `tests/machine/harness.ts` and `tests/integration/server.test.ts` both `import` the same function.

The machine owns every decision: segments, at most 3 semantic clarifications, `CONFIRM_YES` before translation, at most 2 corrections, at most 2 empty-recognition retries, `SWITCH_YES` / `SWITCH_NO` for a direction change, and dropping a stale request by `requestId`. The limits are in `packages/shared/src/types.ts`:

```ts
segmentSeconds: 30
semanticClarifications: 3
correctionAttempts: 2
asrRetries: 2
```

Audio does not enter the XState snapshot. `AudioStore` (`apps/web/src/audio/audioStore.ts`) stays in memory. `lastDelivered` is the text of the previous delivered turn. The machine keeps it in context and sends it as `previousDelivered` on the next interpret or translate. The backend does not store the dialogue itself. With `PROMPT_MEMORY=off` it also drops the `previousDelivered` the client sent (`app.ts`).

So: **dialogue management today depends entirely on browser-side state.** Refreshing the page drops the task in progress and `lastDelivered`. The preset depends on `localStorage` and the URL query. This is not a server session.

### 2.5 Browser APIs

| Capability | Where | Present on Tab5 |
|---|---|---|
| `navigator.mediaDevices.getUserMedia` | `MediaRecorderRecorder.openStream()` | No |
| `MediaRecorder` | `apps/web/src/audio/recorder.ts` | No |
| Secure context (HTTPS) | same file; Vite defaults to HTTPS | Not applicable |
| `<audio>`, `URL.createObjectURL`, iOS `unlock()` | `apps/web/src/audio/player.ts` | No |
| `speechSynthesis` | offline fallback in `apps/web/src/audio/prompts.ts` | No |
| `localStorage` | `presetPreference.ts`, `settings.ts` | No |
| `fetch` + `AbortSignal` | `apiClient.ts`, default timeout 45 seconds | Rewrite with a C/C++ HTTP client |
| `crypto.randomUUID` | `randomId()` in `runtime.ts` | No. The server can generate IDs |
| Web Audio `AudioContext` | **not used in the code** | — |

Recording constraints are echo cancellation and noise suppression only. **No sample rate is set.** The MIME is chosen by what the browser supports, in this order: `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`. iPhone Safari is usually `audio/mp4` (already stated in the README).

### 2.6 Audio format and transport

Upload: `POST /api/asr`. The body is raw bytes. `Content-Type` equals the recording MIME. The cap is `PAYLOAD_LIMITS.maxAudioBytes` = 10 MB.

The server maps MIME to an extension (`extensionForMime()` in `apps/server/src/providers/cloud/index.ts`): m4a, webm, ogg, wav, mp3, flac. Local ASR then uses ffmpeg to convert to 16 kHz mono `pcm_s16le` WAV (`convertToWav()` in `apps/server/src/providers/local/whisper.ts`). Cloud ASR hands the original container to OpenAI.

The TTS response depends on the preset:

| Preset | MIME | Format | Code |
|---|---|---|---|
| cloud | `audio/mpeg` | MP3 | `OpenAISpeechSynthesizer`, `response_format: 'mp3'` |
| local | `audio/wav` | 16-bit PCM, `LEI16@22050` | `LocalSpeechSynthesizer`, macOS `say` |
| mock | `audio/wav` | 16 kHz sine | `makeToneWav()`, default sample rate 16000 |

Prompts are 12 static files: `apps/web/public/prompts/<id>-<zh\|sv>.mp3`. Playback failure falls back to the browser `speechSynthesis`.

Transport is HTTP/1.1 over HTTPS (the Vite proxy in development). There is no WebSocket and no chunked-upload protocol.

### 2.7 Session and synchronization

- `sessionId`, `taskId`, and `requestId` are all generated in the browser.
- A task's `preset` is frozen at `START_TASK`.
- A task in progress exists only in this page's XState actor.
- On cancel or a direction switch, `apiClient` aborts the fetch with `AbortSignal`. The server aborts upstream when the connection closes (`res_onClose` in `app.ts`).
- Multiple segments stay in `AudioStore` until the user presses "finished," then ASR is called segment by segment, in order.

If Tab5 stored this context itself, that would be a rewrite of the state machine into firmware. That is not needed.

### 2.8 Cloud and Local

`apps/server/src/providers/registry.ts` registers `mock`, `cloud`, and `local`. The choice is the `X-Provider-Preset` header, not the client implementation.

- Cloud: OpenAI ASR + Chat Completions JSON schema + TTS. The key stays on the server.
- Local: whisper.cpp (`127.0.0.1:8080`) + Ollama (`127.0.0.1:11434`) + macOS `say`. A failure does not quietly switch to Cloud.
- Every call goes through `observeBundle()` (`apps/server/src/telemetry/observe.ts`) and writes one metadata row to SQLite.

As long as Tab5 still ends at these routes, neither Cloud nor Local moves onto the device. Local still requires whisper and Ollama to be running on this Mac.

### 2.9 Logs, evaluation, and errors

Two separate records:

1. **Client events.** The machine calls `deps.log`. `EventLogger` (`apps/web/src/services/eventLogger.ts`) packs the fields into `EvalEventSchema` (`packages/shared/src/evaluation.ts`) and, after about 400 ms, `POST /api/events`. The schema is strict. An extra field is rejected. Content (audio, transcript, translation) cannot enter this log.
2. **Server model calls.** `observeBundle` writes `ai_requests`. It does not matter who started the call, only that the request reached the backend.

`/monitor` (`apps/web/src/monitor/`) reads SQLite and does not distinguish "iPhone" from "some other client." The schema (`apps/server/src/telemetry/db.ts`) has no `client` column. Sessions can be told apart only by `session_id`.

Error categories (`NETWORK`, `TIMEOUT`, `RECORDER`, `ASR_EMPTY`, and so on) are expressed by `AppError`. The UI shows a network failure as "try again / cancel" on `ErrorScreen`, events `RETRY` / `CANCEL`.

---

## 3. Reusability matrix

| Component | Class | Why |
|---|---|---|
| Types, schemas, limits, and evaluation events in `packages/shared` | Reuse, do not change behavior | The device protocol should use the same event names and limits. The schema is strict today. It changes only if a new field is added |
| XState machine `machine.ts` | Reuse, change the wiring | The logic does not depend on the DOM. Tests already run it in Node. For Tab5, replace the recorder and player in `DialogueDeps`. Do not write another copy in C |
| The machine inside the browser (`runtime.ts`) | Tab5 does not need it | The iPhone app keeps using it. The two wirings can exist together |
| React screens, `BigButton`, CSS, the mascot | Rewrite on Tab5 | ESP32-P4 has no DOM. Keep the interaction kinds (11 screens, the same events). Redraw the pixels for 1280×720 |
| `screenOf()` / `busyStage()` | Reuse, small change | The server can use them to decide which screen to draw. Their parameter types are currently bound to an XState snapshot. They can be called from `apps/web`, or the pure functions can move into shared. Moving a file is later implementation work. This assessment does not change code |
| `MediaRecorderRecorder` | Rewrite on Tab5 | Depends on `getUserMedia` and `MediaRecorder` |
| `AudioPlayer`, `<audio>`, iOS unlock | Rewrite on Tab5 | Depends on HTML audio. The device plays PCM through the ES8388 |
| Copy and the 12 prompt clips in `SpeechPrompts` | Reuse the content, change the player | Copy is in `PROMPT_TEXT`. The files are MP3. The device should use WAV converted ahead of time, or WAV transcoded by the server |
| `speechSynthesis` fallback | Tab5 does not need it | The board has no browser speech |
| `AudioStore` | Reuse the idea | If the machine runs in Node, this in-memory store stays with the machine on the server. The device keeps only "the segment being recorded" |
| `apiClient.ts` | Tab5 does not reuse it directly | The device must not orchestrate ASR → LLM → TTS itself. That is the machine's actor. The device only uploads audio, pulls the view, and pulls PCM |
| Express routes and the three presets | Reuse, add a small interface | Model calls keep the original routes. A new device-session layer is needed, plus WAV output aimed at the device |
| Cloud / Local / Mock adapters | Reuse | They stay on the Mac. Local ffmpeg conversion already accepts WAV |
| `EventLogger` + `POST /api/events` | Reuse the path | If the machine runs on the server, write `EventStore.add` + `db.ingestEvents` directly, the same path `/api/events` uses. Do not let firmware assemble evaluation events |
| `/monitor` UI | Reuse | Model calls from both sides already enter `ai_requests`. Once dialogue events enter the `events` table, overview, tasks, and human scores still work |
| `DevPanel`, preset URL, `localStorage` | Tab5 does not need them | The preset is decided by the device session (a prototype may fix `local` or `mock`) |
| Vite, mkcert, iOS audio unlock | Tab5 does not need them | They serve only the current web page |
| Camera, IMU, RS485, RTC | Tab5 does not need them | Unrelated to translation. K145 has this hardware. The first version should not initialize it, to reduce the chance it contends with the screen and audio |

The machine's dependence on browser state is concentrated in the four side effects injected by `runtime.ts`: record, play, prompts, and `log`. The machine file itself does not read `window`. That is why "leave the machine in Node and only replace the side effects" can hold. **Inferred:** replace `DialogueDeps.recorder` with a recorder that resolves only when the device POSTs audio, and the existing transitions can stay. A later Node test has to prove that. There is no device-session code yet.

---

## 4. Hardware and software compatibility

Figures are from M5Stack documents (checked 2026-10-19; links in section 12).

| Item | Official figure | Meaning for this project |
|---|---|---|
| Main controller | ESP32-P4, RISC-V dual core 360 MHz + LP core 40 MHz | Cannot run Node, React, Whisper, or Ollama |
| Wireless | On-board ESP32-C6-MINI-1U, 2.4 GHz Wi-Fi 6 | Wi-Fi is not inside the P4. The Arduino example sets SDIO pins with `WiFi.setPins(...)` |
| Memory | 16 MB Flash, 32 MB Octal PSRAM | Enough for one frame and several short clips. See the budget below |
| Panel | 5-inch IPS, 1280×720. The document names the driver ST7123 / ST7121 | Landscape. One RGB565 frame is about 1.84 MB |
| Touch | The document says the driver is integrated in the display chip. The Espressif BSP lists both GT911 and ST7123 | **Open:** which chip the batch you receive actually has. Confirm with an example that lights up |
| Audio | ES8388 codec + ES7210 echo-cancellation front end, dual microphones, 1 W / 8 Ω speaker NS4150B | Can record and play. The official microphone example says the two cannot be on together |
| Power | The kit includes an NP-F550, 7.4 V 2000 mAh. The document's runtime is about 6 hours (50% brightness, Wi-Fi always on) | Enough for a desk prototype. A full day with children needs a separate measurement |
| Cellular | No modem. The expansion pads support Cat.M / NB-IoT / LoRaWAN modules | This is not LTE. See milestone M7 |
| USB | Type-C USB 2.0 OTG | The Mac flashing port. Download mode: hold Reset until the green LED flashes quickly |

### 4.1 Chinese and Swedish

The official microphone example uses `fonts::FreeSansBoldOblique18pt7b`. That Latin font **cannot** draw Chinese characters. Swedish `å ä ö` also cannot be assumed to be in FreeSans. Look at a real string in M1.

M5GFX is used by switching to a built-in or external CJK bitmap (the M5 ecosystem often uses something like `efontCN_*`). On the Espressif side it is an LVGL bitmap font or FreeType. Both can draw Unicode. The cost is Flash space and the speed of the first draw. Child buttons should stay color, icons, and ✓ / ×. Chinese characters are only for short adult lines and the translation. A translation may be a full Chinese or Swedish sentence, so it needs wrapping. A single large line is not enough.

**Inferred:** 16 MB of Flash can hold a common Chinese subset plus Latin extended. A full CJK TTF plus a FreeType cache would crowd PSRAM. The first version should not take that path.

### 4.2 Large buttons and touch

On 1280×720, two buttons side by side can be far larger than the current 64 px / 96 pt requirement. The official example uses `M5.Touch.getCount()` and `wasClicked()`. Multi-touch exists. This product needs only one contact at a time.

**Open:** mis-taps by a child's finger on 5-inch glass, and whether a thumb can reach the lower primary button in landscape. That is an observation for M1. Documents cannot answer it.

### 4.3 Recording length and memory

The official example (Tab5 Mic on `docs.m5stack.com`):

- Sample-rate constant `17000`
- Buffer of `256 × 720` `int16` samples, about 360 KB
- Duration about `184320 / 17000 ≈ 10.8` seconds, and it is a ring that overwrites
- Comment, in substance: the microphone and the speaker cannot be used at the same time. Call `M5.Mic.end()` before playback, and `M5.Speaker.end()` before recording

One segment in this product is capped at 30 seconds, not 5. The hoped-for 5–15 seconds is one way of using that cap. The device should use a linear buffer and stop itself at 15 seconds (or still obey the machine's 30 seconds).

Estimate at 16 kHz, mono, 16 bit:

| Duration | PCM size |
|---|---|
| 5 seconds | 160 KB |
| 15 seconds | 480 KB |
| 30 seconds (current product cap) | 960 KB |

32 MB of PSRAM still has room for one 30-second clip plus one RGB565 frame (about 1.84 MB). The risk is not total capacity. It is:

- The allocation must use PSRAM (the example uses `heap_caps_malloc`). It must not go into internal RAM.
- Before the next segment is recorded, the previous one should already have been uploaded and can be released. The machine today allows several segments and then recognition together. If Wi-Fi drops, the device should keep only the segment the server has not yet acknowledged.
- Recording and playback must be serial. The current machine calls `recorder.prepare()` near the end of a prompt, to open the iPhone microphone early. On Tab5 that warmup conflicts with the prompt. The device-side `prepare()` should be a no-op, and the microphone should open after the prompt finishes.

Sample rate: the example is 17 kHz. The Whisper path resamples to 16 kHz with ffmpeg again. To avoid one pointless resample, the device should record at 16 kHz and wrap a standard WAV (44-byte header + PCM). `extensionForMime()` already knows `wav`. **Open:** whether the ES8388 on this board stably accepts 16000, or must use the example's 17000. M2 settles it by recording once at each rate.

### 4.4 Upload, download, and playback

A 480 KB WAV is small on LAN Wi-Fi. A short TTS clip at 22050 Hz, mono, 16 bit, about 5 seconds, is about 220 KB, also small.

For playback, the Arduino example is `M5.Speaker.playRaw(pcm, length, sampleRate, stereo, ...)`. It consumes PCM, not MP3. Local and Mock already return WAV. Cloud returns MP3.

**Inferred:** the first version converts Cloud MP3 to WAV on the Mac, then sends it to Tab5. The ESP-ADF MP3 example ships `sdkconfig.defaults.esp32p4`, so someone is decoding MP3 on the P4. It is not a ready Tab5 BSP feature, and it stacks on top of "microphone and speaker are exclusive" and screen refresh. Do not put decoding in the firmware during the prototype.

### 4.5 Network drops

The current page turns a network failure into `ErrorScreen`. The user presses `RETRY`. The machine returns to ASR, interpretation, translation, or recording according to the stage that failed (`recoverableError`). The device can follow that model:

- Upload failed: keep this PCM, show retry, and do not record again unless the user chooses to.
- TTS download failed: matches the existing `audioStatus === 'failed'` and `RETRY`.
- View polling failed: stay on the last screen, show disconnected, and ask the server for the current screen again after recovery.
- After the device disappears, the server must give up a stuck `recorder.stop()` wait, or the next session deadlocks. That needs a heartbeat or a timeout. Today's code has no such session. It is the new code's job.

The Wi-Fi stack runs on the C6 and reaches the P4 over SDIO. The display is MIPI-DSI. Audio is I2S. **Open:** whether keeping Wi-Fi up while recording, or uploading while refreshing 720p, causes pops or disconnects. M3 and M4 measure this on purpose. Do not turn Wi-Fi on during M2 and assume there is no interference.

### 4.6 Server reachability (as important as the hardware)

Tab5 cannot use the Vite proxy. To let it reach the current Node, `HOST` has to be set to this Mac's LAN address at least. That exposes the **unauthenticated** `/api/asr`, `/api/interpret`, `/api/translate`, `/api/tts`, and `/api/events` to anyone else on the same Wi-Fi. The Cloud preset would then send arbitrary uploaded audio to OpenAI. This is a required change for the migration. Firmware cannot solve it alone.

---

## 5. Recommended development environment

The comparison is the path M5 currently writes for **ESP32-P4 / Tab5**, not a generic ESP32-S3 template. An S3 board, partition, and Wi-Fi example cannot be reused. The P4 has no on-chip Wi-Fi, the panel is MIPI-DSI 720p, and wireless means initializing the C6.

### A. Arduino + M5Unified / M5GFX

The official quick start requires:

- M5Stack board package: microphone example ≥ 3.2.0, Wi-Fi example ≥ 3.2.2
- Board selection `M5Tab5`
- M5Unified ≥ 0.2.23, M5GFX ≥ 0.2.30 (the document says this version range is what covers the LCD drivers of different batches)

Examples that exist: display and touch, microphone record-and-play, Wi-Fi STA (including `WiFi.setPins` and the board-level `BOARD_SDIO_ESP_HOSTED_*`), and antenna switching.

Advantage: pins, the exclusive relationship, and library versions for the microphone and Wi-Fi already have official snippets that compile. Large color-block buttons drawn with M5GFX are enough for a prototype.  
Disadvantage: Chinese needs another font. Layout is handwritten coordinates. The official PlatformIO snippet uses the board name `esp32-p4-evboard` plus `board_build.mcu = esp32p4`, not a stable board called `m5stack-tab5`. P4 support in the official Arduino core follows ESP-IDF 5.4 and is still younger than S3.

### B. PlatformIO, written in Cursor

The `platformio.ini` in the M5 document is:

- `platform = https://github.com/pioarduino/platform-espressif32.git#54.03.21`
- `framework = arduino`
- `board = esp32-p4-evboard`
- `board_build.mcu = esp32p4`
- Flash mode `qio`, with `BOARD_HAS_PSRAM` and USB CDC turned on

`54.03.21` corresponds to Arduino core 3.2.1 and ESP-IDF 5.4.2 (pioarduino release notes). This is a community-maintained PlatformIO platform, not the older `platformio/espressif32` in the PlatformIO registry. Arduino 3.x was missing from upstream PlatformIO for a long time, so pioarduino is required. In community discussion, the earlier `#54.03.20` failed to build because of a wrong esptool argument. The document later moved to `54.03.21`. **Pin a release zip. Do not track a git branch that moves.**

Cursor is based on VS Code, so the PlatformIO extension can be installed. Dialogue and the backend in this repository stay on the current TypeScript toolchain. Firmware is a separate project beside it. AI help on `platformio.ini` and a small amount of C++ is realistic. The extension is not built into Cursor. The first install and the Python environment belong in M0.

Flashing on a Mac: USB-C. The official way into download mode is to hold Reset until the green LED flashes quickly. Native USB CDC on macOS usually appears as `/dev/cu.usbmodem*`. **Open:** whether this Mac also needs an extra driver. That cannot be decided before it is plugged in.

### C. ESP-IDF + Espressif Tab5 BSP + LVGL

The official factory-firmware tutorial specifies **ESP-IDF v5.4.2**, repository `m5stack/M5Tab5-UserDemo`, dependencies via `fetch_repos.py`, and `idf.py flash` inside `platforms/tab5`. The tutorial body uses Ubuntu as the example and points at Espressif's Linux and macOS getting-started guides. macOS can be installed, but the paths and the Python virtual environment are more likely to collide with other projects on this machine than PlatformIO is.

The Espressif component `espressif/m5stack_tab5` (1.2.x was visible in the registry when checked) declares: display (the document table lists both ILI9881C and ST7123), an LVGL port, touch (GT911 and ST7123), ES8388 speaker, ES7210 microphone, and microSD. BSP examples include an LVGL display and "display + audio + photo." Wi-Fi still has to be wired separately through `esp_wifi_remote` / the hosted stack, to the C6. That is less direct than M5's 20-line STA example.

Advantage: a 720p UI, touch gestures, wrapping, and fonts are easier to maintain over time, and it lines up with the chip vendor's P4 support.  
Disadvantage: the first week is spent on CMake, `menuconfig`, component versions, and font conversion, not on "can it record a child speaking." The display driver is not clean between the M5 product page (ST7123) and the BSP table (both panel generations are listed). The wrong BSP version is a black screen.

### Prototype choice

**The first hardware prototype uses B: PlatformIO inside Cursor, with the framework from A, Arduino + M5Unified / M5GFX.**

Reasons:

1. M0–M3 have to prove USB flashing, 720p touch, 5–15 seconds of record and playback, and C6 Wi-Fi. M5 already has examples for all four, and the pins are fixed.
2. ESP-IDF + LVGL is a better fit after audio and the network already work, when the full child UI is built. Starting both stacks now makes it impossible to tell a panel revision, a font, and the protocol apart while debugging.
3. The state machine and the API stay in this TypeScript repository. Keeping the firmware thin, and looking at both sides in Cursor, fits. PlatformIO's single entry `src/main.cpp` is easier to review than an IDF component tree.
4. If M1 finds that the panel on the board in hand can be lit only by the BSP, move the display layer to C then. Do not start on IDF from day one for that possibility.

Longer term (after M5, if the UI states multiply): replace drawing with the ESP-IDF BSP + LVGL. The protocol layer can stay. That is an intentional firmware rewrite, not a precondition of the prototype.

Version starting point (lock it again at implementation time): the pioarduino `54.03.21` zip, M5Unified ≥ 0.2.23, M5GFX ≥ 0.2.30, board-level USB CDC on, PSRAM on. Do not use `board = esp32-s3-devkitc-1` or any S3 partition table.

---

## 6. Proposed architecture

```text
iPhone Safari                         Tab5 K145
React + XState in the browser        screen / touch / mic / speaker / Wi-Fi
        |                                     |
        |  existing /api/asr|interpret|       |  new device session
        |       translate|tts|events          |  (view + audio + button events)
        v                                     v
        +----------------+--------------------+
                         |
                    Node on the Mac
                         |
         +---------------+----------------+
         | existing providers (mock/cloud/local) |
         | the same XState, hosted again for Tab5 |
         | EventStore + telemetry.sqlite    |
         +----------------------------------+
                         |
              OpenAI    or    whisper + Ollama + say
              (cloud only)    (local only, still bound to 127.0.0.1)
```

Principles:

- **The iPhone path keeps working with no line changed.** The browser keeps its own state machine and `AudioStore`.
- **Tab5 does not embed the state machine.** It is a renderer and an audio peripheral.
- **A second state machine runs in the existing Node process**, one actor per paired device. Reuse `createDialogueMachine()`. The recorder's `stop()` waits until the device uploads the WAV. The player's "play" becomes "put PCM in the outbound slot and wait until the device reports playback finished."
- **Model calls do not go around a new protocol.** The server actor calls the provider that is already wrapped by `observeBundle`, so `/monitor` request rows, latency, and cost share the same code as the web page.
- **Firmware does not assemble evaluation events.** The actor's `deps.log` writes the existing `EventStore` and `db.ingestEvents` inside the process. The dashboard therefore sees web sessions and Tab5 sessions together.
- **Distinguish the client with a `sessionId` prefix**, for example `tab5-...` versus the web UUID. That avoids changing the strict `EvalEventSchema` first. Filtering is a display improvement on the monitor and can come later.
- **Audio is WAV PCM at the device boundary.** Upload: 16 kHz mono s16 WAV. Download: WAV as well. Cloud MP3 exists only on the Mac.
- **Prompts are WAV in device Flash** (converted offline from the existing 12 MP3 files). "Something went wrong" can still be spoken with no network. The dynamic confirmation sentence and the translation still come from the server.
- **Transport is LAN HTTP. Short polling is enough.** The server has no WebSocket today. A 480 KB upload is one POST. Chunking is not needed. Poll every 200–400 ms, and only while waiting for the server to enter the next screen. Do not poll during recording.
- **One device session keeps only one unacknowledged segment.** The next segment is allowed only after the server acknowledges this one. That is compatible with the machine keeping many segments in `AudioStore`: `AudioStore` is in server memory, and device memory holds only the current segment.
- **The preset stays `mock` until M4, then switches to `local`.** Cloud spends money and adds an MP3 transcode. It should not be the preset used to bring up the first board.

The web page and Tab5 can be open at the same time. They are two sessions. Do not let two clients share one `taskId`.

The server bind stays `127.0.0.1` by default. For Tab5, start separately with the environment variable `HOST=0.0.0.0` (or this Mac's LAN IP) and add a device token. Do not bind Ollama or whisper to `0.0.0.0`. The README already marks that as a security issue. The migration must not break it.

---

## 7. API changes required

The JSON shape of the four existing model routes and of `/api/events` can stay. The web client keeps calling them as it does today.

What must be added is **added**. The old contracts are not changed:

| Change | Why | If it is not done |
|---|---|---|
| `HOST` can be set to the LAN (the variable already exists; the default stays loopback) | Tab5 cannot reach `127.0.0.1` | The device cannot connect |
| A device token, for example `Authorization: Bearer`, protecting only `/api/device/*` | ASR on the LAN would send audio to Cloud | Any device on the same network can call it |
| `POST /api/device/sessions` | Creates the server actor and returns `sessionId` | There is nowhere to keep the machine |
| `GET /api/device/sessions/:id` | Returns the current screen, the short adult text, the button list, whether audio is waiting to play, and the error category | Firmware would have to understand XState itself |
| `POST /api/device/sessions/:id/events` | Body is an existing `DialogueEvent` (`START_TASK`, `STOP_SEGMENT`, `CONFIRM_YES`, and so on) | The machine cannot be driven |
| `PUT /api/device/sessions/:id/segment` | Raw `audio/wav` body, submitted while the machine is waiting in `stopRecording` | The recording cannot enter ASR |
| `GET /api/device/sessions/:id/audio` | Returns the WAV waiting to play. After playback the device sends `DELIVERY_FINISHED` | Result speech cannot reach the speaker |
| Cloud TTS is converted to WAV on the device path | `playRaw` does not consume MP3 | The Cloud preset has text and no sound |
| Session heartbeat and timeout | When the device loses power, the server must not sit in `recorder.stop()` forever | One disconnect kills the session |
| Optional: `sessionId` uses a `tab5-` prefix | The dashboard can tell the source apart without relaxing `EvalEventSchema` | The two logs mix. They still work, but cannot be separated |

Explicitly do not:

- Do not sync the whole machine context to the device.
- Do not let the device call `/api/interpret` and `/api/translate` itself to decide the next step. That would reimplement the clarification count and "must confirm."
- Do not change the web page's MP3 TTS for Tab5. Transcode only when the device fetches audio.
- Do not add a `client` field to `/api/events` unless the Zod strict schema, the CSV columns, and the monitor UI change together. The prefix is enough for M6.
- Monitor login stays a browser cookie. Tab5 does not open `/monitor`.

`POST /api/events` stays for the web page. Evaluation events for a Tab5 session are written inside the process by the server actor, so a firmware crash does not drop an event such as `CONFIRMATION_YES`. Model-call rows live in `observeBundle`. Whether the device is online does not change "how long this ASR took."

---

## 8. Migration milestones

Firmware is suggested outside the repository, or at `firmware/tab5/` (not created). "Files to create" below is a later target. This assessment has not done it. Every flash is: USB-C to the Mac, hold Reset into download mode if needed, then PlatformIO Upload. Serial log at 115200.

### M0: environment and hardware connection

- Tools: Cursor, the PlatformIO extension, the pioarduino platform zip (suggested `54.03.21`), a data USB-C cable, and one K145.
- Files: new `firmware/tab5/platformio.ini` and `firmware/tab5/src/main.cpp` (print only the chip and the PSRAM size). Do not change `apps/`.
- Flash: `pio run -t upload`, then the serial monitor.
- Test: confirm the port appears, the flash finishes, and the log is still there after reset. Unplug once and flash again.
- Expected: the serial log shows ESP32-P4 and about 32 MB of PSRAM. The screen may still be the factory image.
- Risk: download mode was not entered, the cable is charge-only, or an expired platform tag makes esptool fail.
- Acceptance: two flashes from scratch succeed in a row, and the chip in the log is P4, not S3 or C6.

### M1: text and touch

- Tools: M5Unified ≥ 0.2.23, M5GFX ≥ 0.2.30.
- Files: change only the firmware `main.cpp`. Prepare a test frame containing "说中文", "Prata svenska", "åäö", and two full-width buttons.
- Flash: same as M0.
- Test: tap the left button, the right button, and the gap between them. Rotate or lock one landscape orientation. Do not change the coordinate system halfway.
- Expected: 720p lights up full screen. Both buttons are at least 96 px tall. Chinese is not boxes. Swedish extra characters are correct. The gap does not fire a button.
- Risk: the panel is ST7123 or ILI9881C, the font has no Chinese, or the touch coordinates are mirrored.
- Acceptance: an adult can read one Chinese sentence and one Swedish sentence on the screen. A child-sized tap (finger pad, not only a stylus) lands on the target button at least 9 times out of 10.

### M2: record 5 seconds and play it back

- Tools: same as M1. Allocate the buffer from PSRAM.
- Files: a record/play module inside the firmware. No network.
- Flash: same as M0.
- Test: play a prompt or a beep to the end, then record 5 seconds, then play it back from the speaker. Then change the length to 15 seconds and repeat. Do not initialize Wi-Fi during recording. Try 16000 Hz and the example's 17000 Hz separately.
- Expected: playback is intelligible. No obvious cut-off. 15 seconds does not reboot.
- Risk: microphone and speaker open together and fail, internal-RAM allocation fails, or only one of 17 kHz and 16 kHz works.
- Acceptance: 5 seconds and 15 seconds each succeed 3 times. The log prints the buffer size in bytes (5 seconds should be on the order of 160000 for 16 kHz mono s16). The microphone is `end()` during playback.

### M3: Wi-Fi, and one test request to Node

- Tools: home 2.4 GHz Wi-Fi (do not assume 5 GHz works; the C6 document says 2.4 GHz Wi-Fi 6). Start the existing service on the Mac with `HOST=0.0.0.0`. The firmware has one shared test secret. Do not commit it.
- Files: firmware Wi-Fi/HTTP. The server can start by calling the existing `GET /api/health`. If health is still unauthenticated, do the test only on a trusted LAN, and turn `0.0.0.0` back off at the end of M3 unless the M4 token is already in place.
- Flash: same as M0.
- Test: connect to Wi-Fi on power-up, show the IP on the screen, request `http://<mac>:8787/api/health`, and draw `version`. Unplug the Mac's network cable or stop the service. The screen should show failure, not hang.
- Expected: connected within 10 seconds. `version` in the health JSON matches `APP_VERSION` in `packages/shared` (the current code is `0.1.0`).
- Risk: SDIO pins were not set as in the Tab5 example, the router isolates wireless clients, or the service is still bound to `127.0.0.1`.
- Acceptance: five cold starts in a row connect and complete health. On failure there is a Retry button, and retry does not reset the whole board.

### M4: upload a real recording and get text and sound back

- Tools: ffmpeg is already on this machine (Local mode needs it anyway). Use `mock` first, then `local`.
- Files: firmware WAV wrapping and upload. A minimal server device session (create a session, submit one clip, fetch WAV). At this point a straight line "one recording → ASR → translate → TTS" is enough to confirm the speech path. Full branches wait for M5.
- Flash: same as M0. The server uses the existing `npm run dev` plus `HOST`.
- Test: say one fixed Chinese sentence into the microphone. Under mock, the scripted translation and a beep WAV should appear. Under local, real recognition and a `say` WAV should appear, and the speaker should play it. Then test 15 seconds of silence. The result should be an understandable empty recognition or an error, not a hang.
- Expected: the translation appears on the screen. What the speaker plays is the WAV returned by the server, not the raw M2 recording.
- Risk: a bad WAV header makes ffmpeg or OpenAI reject it, Cloud MP3 is sent straight to `playRaw`, or the audio task and Wi-Fi deadlock each other during upload.
- Acceptance: the mock path has text and sound all 5 times. The local path succeeds 3 times with an adult voice. `/monitor` shows the matching ASR and TTS rows, the preset is correct, and the local cost is 0. On failure the PCM is still there, so retry does not require recording again.

### M5: the full confirmation flow

- Tools: same as M4. Match the 11 screens in `screens.tsx`, not the CSS.
- Files: a full server device session (wrapping `createDialogueMachine`). Firmware renders, from the `GET` view: home, recording, continue/finished, busy, clarify, confirm, result, switch, error, fallback, and didn't-hear.
- Flash: same as M0.
- Test: run the scenarios from `tests/machine` on the server first with a "fake device." Then on the board walk Chinese→Swedish confirmation (yes / no), one clarification, one direction switch, and one power-pull reconnect.
- Expected: there is no translation before confirmation. When "no" reaches the cap, the fallback appears, and a translation is not guessed. A direction switch asks `SWITCH_YES` first.
- Risk: the buttons on the device and the server screen disagree, the prompt overlaps the microphone opening, or polling sends the previous `DELIVERY_FINISHED` twice.
- Acceptance: the board completes one ZH→SV confirmation path and one SV→ZH direct-translation path. After the network drops, Retry does not reset the task counters unless the user pressed cancel. The Node machine tests stay green.

### M6: evaluation and logs

- Tools: the existing `/monitor`. Tab5 does not need another dashboard.
- Files: the server actor's `log` writes `EventStore` and `ingestEvents`. `sessionId` has a `tab5-` prefix. The web path keeps `EventLogger`.
- Flash: if firmware does not assemble events, M6 can change only the server and restart Node.
- Test: within the same hour, the iPhone finishes one task and Tab5 finishes one task. Find both under Requests, Tasks, and Evaluation. Give the Tab5 task a human score.
- Expected: stage time, preset, and cost appear the same way as a web task. Evaluation events include `TASK_STARTED`, `CONFIRMATION_YES`, or `TASK_COMPLETED`. The database still has no transcript text.
- Risk: the actor records on the server and the web page records again, so events are doubled. The Tab5 path must not also `POST /api/events`.
- Acceptance: both sessions are in the exported CSV and can be separated by the `sessionId` prefix. A sentinel check still shows that no audio or translation was stored (keep the existing test approach).

### M7: assess LTE on its own

- Tools: paper and an experiment design only. Do not put a cellular module on the M0–M6 bill of materials.
- Files: a later appendix to this file is enough. Do not change firmware.
- Test: no hardware test until the Wi-Fi prototype's M4 has passed, and there is a real audio byte count and an end-to-end latency.
- Expected: a "buy / do not buy" note.
- Risk: treating Cat.M as LTE.
- Acceptance: see section 11. The current judgment is **do not buy yet**.

The K145 expansion pads support modules in the Cat.M, NB-IoT, and LoRaWAN class, not on-board LTE. Those networks have low bandwidth and high round-trip time. They do not fit 15 seconds of audio plus several confirmation turns. A USB-A LTE dongle has no Tab5 example in the documents. Cellular also means NAT, certificates, and data charges. After M4 has real traffic and latency, decide whether cellular is worth doing, and treat it as another product stage.

---

## 9. Risks and unknowns

| Item | Status | Notes |
|---|---|---|
| Can the recorder be swapped without changing machine logic | Inferred | Dependency injection in the tests supports it. The device session is not written, so this is not a measurement yet |
| Microphone and speaker are exclusive | Verified (official example comment) | The prompt must finish before the microphone opens. This is the opposite of the iPhone optimization that opens the microphone early |
| The official example is only an ~11-second ring buffer at 17 kHz | Verified | 15 seconds is feasible, but it needs a new linear PSRAM buffer. 30 seconds is also feasible by capacity (about 960 KB) |
| Whether this ES8388 accepts 16 kHz | Open | The binary experiment in M2 |
| Panel driver is ST7123 or ILI9881C / touch is the integrated chip or GT911 | Open | The product page and the BSP table disagree. Pin the library version to the board in hand |
| FreeSans cannot draw Chinese | Verified (example font) | M1 passes only after a CJK font is in place |
| Wi-Fi is on the C6, over SDIO | Verified | Stability while recording and refreshing 720p at the same time is unmeasured |
| Cloud TTS is MP3, and the playback example is PCM | Verified | The prototype converts to WAV on the server |
| The service listens only on 127.0.0.1 by default, and the translation API has no auth | Verified | Add a device token before exposing it on the LAN |
| Local engines must stay on the Mac loopback address | Verified | Tab5 talks only to Node, not to 11434 / 8080 |
| ESP-ADF can decode MP3 on the P4 | The documents have a P4 sdkconfig. **Not verified on Tab5** | Not a prototype path |
| Whether macOS needs an extra USB driver | Open | M0 |
| Child-speech recognition rate | Not verified, and outside this note | The README says V1 is a feasibility test with adult / synthetic speech. Changing hardware does not change that |
| Battery life under "full brightness + continuous Wi-Fi + audio" | Open | The official ~6 hours is a different load |
| Dual microphones and AEC when recording starts right after the speaker | Open | The tail of the prompt may be recorded. M5 has to listen to a real recording |
| pioarduino tags expire | The community build failure of 54.03.20 was seen | Pin a zip, and write the reproducible version into `platformio.ini` |

Before buying a second board or any radio module, finish these experiments on the one board in hand:

1. Whether the official microphone example flashes on this Mac and plays back.
2. Whether switching to 16 kHz and a 15-second linear buffer reboots.
3. Whether the official Wi-Fi example joins the 2.4 GHz network in the room where the device will sit.
4. Which library version lights the screen and the touch together. Write down the panel behavior as the hardware-revision record for this board.
5. `GET` the Mac's `/api/health` from Tab5 (open `HOST` only briefly).

If any of the five fails, do not buy more hardware. Fix the toolchain or the network first.

---

## 10. Effort estimate

One person who knows this repository and has not built ESP32-P4 before. The unit is person-days, including debugging, excluding waiting for shipping.

| Stage | Range | Where the work is |
|---|---|---|
| Environment | 1–3 person-days | M0. The top of the range is a USB download-mode or pioarduino install failure |
| Basic hardware check | 3–6 person-days | M1–M2. Font and panel revision are the main variables |
| Network and audio | 5–10 person-days | M3–M4. Includes WAV, LAN bind, and failure retry. Add 2–4 person-days if Cloud MP3 transcoding is included |
| Dialogue UI migration | 8–15 person-days | M5. Most of it is the session and the view on Node. Firmware is 11 simple screens. The machine logic itself is not rewritten |
| Test and stabilize | 4–8 person-days | M6 plus network drops, repeated taps, mic/speaker switching, and using it beside the iPhone |
| Total to a usable prototype | **21–42 person-days** | About 4–8 calendar weeks. Do not estimate it as "compile React onto the board." That path does not exist |
| LTE assessment | 1–2 person-days on paper. If a module is actually built, add 5–15 person-days and it will likely be rejected | A separate stage |

The top of M5 comes from the session protocol and the timing of "the machine is on the server, the audio is on the device," not from drawing buttons. Make the protocol green with the fake recorder in `tests/machine` before going on the board. That takes hardware waiting off the critical path.

---

## 11. Purchase recommendation

**One Tab5 Kit K145 can be bought**, and used for M0–M4. The kit adds a battery over the bare board, which helps when leaving the USB debug supply, but keep the USB-C cable for flashing.

Do not buy now:

- An LTE / 4G module, a SIM, or an antenna. The board has no LTE modem. The expansion port is the Cat.M / NB-IoT / LoRa class, which does not fit this interactive audio.
- A second Tab5. Before M2 and M3 pass, a second board does not solve the driver or the Wi-Fi.
- An external microphone or speaker. Use the on-board dual microphones and the NS4150B first. If M2 fails, a 3.5 mm headset is only a way to separate "the amplifier is dead" from "the firmware is silent." That is a debug accessory, not the product path.
- A microSD, unless M1 shows the font will not fit in 16 MB of Flash.

Before purchase, documents and the protocol design are enough. The first week after purchase is only the five experiments in section 9. If Wi-Fi or recording fails among those five, stop device-session development and write the hardware problem down first.

If the box has no data USB-C cable, get one. A charge-only cable makes M0 look like a dead board.

---

## 12. Go / no-go

**Conditional go.**

In scope:

- Keep the existing React / iPhone app and the existing Node presets.
- Add one Tab5 thin client.
- The dialogue state machine remains the one in `apps/web/src/dialogue/machine.ts`, with Node running another actor for the device.
- The first prototype toolchain is Cursor + PlatformIO (pioarduino) + M5Unified / M5GFX.
- Buy one K145 first.

Out of scope:

- Running the existing frontend or backend on Tab5.
- Rewriting a clarification / confirmation state machine in firmware.
- Putting Whisper, Ollama, or an OpenAI key on the device.
- Buying cellular hardware before M4 passes.
- Configuring this P4 with an ESP32-S3 project setup.

The condition for starting firmware work: accept that the server needs a new device session and a device token, and accept that Cloud speech is converted to WAV on the device path. If briefly exposing Node on the LAN is not acceptable even with a token, this migration should stop at M2. Tab5 can only be an offline recorder, not a translator.

---

## Sources

Code (this repository, the workspace version at the time of the assessment):

- `apps/web/src/dialogue/machine.ts`, `types.ts`, `selectors.ts`
- `apps/web/src/services/runtime.ts`, `apiClient.ts`, `eventLogger.ts`, `presetPreference.ts`
- `apps/web/src/audio/recorder.ts`, `player.ts`, `audioStore.ts`, `prompts.ts`
- `apps/web/src/ui/App.tsx`, `screens.tsx`, `BigButton.tsx`, `hooks.ts`
- `apps/server/src/app.ts`, `index.ts`, `config.ts`
- `apps/server/src/providers/cloud/index.ts`, `local/whisper.ts`, `local/tts.ts`, `mock/index.ts`
- `apps/server/src/telemetry/observe.ts`, `db.ts`
- `packages/shared/src/types.ts`, `contracts.ts`, `evaluation.ts`
- `tests/machine/harness.ts`
- `README.md`, `docs/01-zh/03-界面设计需求.md`

External documents (checked 2026-10-19):

- M5Stack Tab5 product page and specifications: <https://docs.m5stack.com/en/core/Tab5>
- Tab5 Arduino microphone example: <https://docs.m5stack.com/en/arduino/m5tab5/mic>
- Tab5 Arduino Wi-Fi example: <https://docs.m5stack.com/en/arduino/m5tab5/wifi>
- Tab5 ESP-IDF factory firmware build (ESP-IDF v5.4.2): <https://docs.m5stack.com/en/esp_idf/m5tab5/userdemo>
- Espressif BSP `espressif/m5stack_tab5`: <https://components.espressif.com/components/espressif/m5stack_tab5>
- BSP source tree: <https://github.com/espressif/esp-bsp/tree/master/bsp/m5stack_tab5>
- pioarduino 54.03.21 (Arduino 3.2.1 / ESP-IDF 5.4.2): <https://github.com/pioarduino/platform-espressif32/releases/tag/54.03.21>
