# 02 Developer guide

Series: [01 System design](01-system-design.md) · **02 Developer guide** · [03 UI brief](03-ui-brief.md) · [04 Tab5 feasibility](04-tab5-feasibility.md) · [05 Code guide](05-code-guide.md) · [06 Research prompts](06-research-prompts.md) · [07 Module structure](07-module-structure.md) · [08 How the modules fit](08-how-modules-fit.md) · [09 Code walkthrough](09-code-walkthrough/00-start-here.md)

The Chinese file is in [`docs/01-zh`](../01-zh/02-开发说明.md).

The project overview and the screens are on the repository home page, [`README.md`](../../README.md). This page is the operating guide for install, configuration, phone testing, and the monitor.

小翻译 · Lilla Tolken — Minimal V1 (v1.2: Cloud + Mac local + `/monitor`)

A **Chinese ↔ Swedish** push-to-talk translator prototype for preschool children.
**V1 is only a feasibility test with adult or synthetic speech.** It is not a child usability study, and it does not prove child-speech recognition accuracy.

The only authoritative design document is [01 System design](01-system-design.md).

- **One** React UI + **one** XState v5 state machine + interchangeable `mock` / `cloud` / `local` providers.
- Chinese → Swedish: record → recognize → interpret → clarify when needed (at most 3 questions) → **the meaning must be confirmed** → translate → Swedish text + speech.
- Swedish → Chinese: record → recognize → translate directly → show the recognized Swedish original + the Chinese translation + Chinese speech.

## 1. Quick start

**Node.js ≥ 22.13** is required (the monitor database uses the built-in `node:sqlite`; tested on Node 23.9).

```bash
npm install
npm run dev          # backend (127.0.0.1:8787) and frontend (https://localhost:5173) together
```

The **mock** preset works with no key at all. It is fully offline and the results are predictable.

- For a quick desktop try: `HTTPS=off npm run dev`, then open <http://localhost:5173> (`localhost` is itself a secure context, so the microphone is available).
- The gear at the top right opens the developer panel: pick a Mock scenario, switch the preset, export CSV.
- Start from Home with 🇨🇳🎤➜🇸🇪 or 🇸🇪🎤➜🇨🇳. The Mock preset uses a **scripted microphone** by default. You do not speak. Press ⏹ and the "heard" text comes from the selected scenario script.

### Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Backend + frontend (hot reload) |
| `npm run check` | Typecheck + lint + all tests + build |
| `npm test` | Tests only (vitest) |
| `npm run typecheck` / `npm run lint` | Either check on its own |
| `npm run check:cloud` | Smoke-test OpenAI with **synthetic text** (needs a key; a small charge) |
| `npm run local:doctor` | Inspect this Mac (chip / memory / disk), tools, models, and engines, then print the next step |
| `npm run local:start` | Start the whisper.cpp server (127.0.0.1 only) and check Ollama |
| `npm run local:smoke` | Run local ASR → interpret → translate → TTS with **synthetic speech** from macOS `say` |
| `npm run local:eval -- --help` | Compare local models on the fixed adult / synthetic scenario set |
| `npm run local:e2e -- --url http://127.0.0.1:8787 --preset local` | Run a full task over real HTTP (the same path as the browser) and write `/monitor`. `--preset cloud` also needs `--allow-cloud` (this spends money) |

## 2. OpenAI API key (Cloud preset)

The key is read **only on the backend**. The browser never receives it.

```bash
cp .env.example .env
# Edit .env. At least set:
OPENAI_API_KEY=sk-...
```

`.env` lives at the repository root and is ignored by `.gitignore`. Restart `npm run dev` after a change. Optional variables are in [`.env.example`](../../.env.example):

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_ASR_MODEL` | `gpt-transcribe` | Speech recognition. This model uses `languages` and no longer accepts the old single `language` field |
| `OPENAI_LLM_MODEL` | `gpt-6-luna` | Interpretation + translation (strict JSON schema). Default reasoning effort is medium |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-realtime-2.1-mini` / `alloy` | Speech. Realtime receives only the translation text and returns WAV. Set the model back to `gpt-4o-mini-tts` to use the older Speech API (mp3) |
| `OPENAI_LLM_TEMPERATURE` | `0` | Dialogue and vision requests for `gpt-6-luna` omit this parameter (the default reasoning effort rejects `temperature`). Other models still send it |
| `PROMPT_MEMORY` | `on` | Whether the "last delivered message" is sent to the LLM as optional context. Keep this the same when comparing Cloud and Local |

> The default model IDs were set from what was known when the code was written. **They have not been verified against a real account as currently available to you.** If a call fails, change `.env` to a model your account can use. The model and prompt version are written into the evaluation log as `modelTag`, so an adult test can be repeated.

**Check Cloud:**

```bash
npm run check:cloud
```

It runs TTS (Chinese) → ASR (Chinese) → interpret → translate (Chinese→Swedish) → TTS (Swedish) → ASR (Swedish) → translate (Swedish→Chinese), all on synthetic text, and prints the time for each step. With no key it prints `SKIPPED` and exits with code 2 (**that is not a pass**). Then tick the "adult / synthetic speech only" statement in the gear panel and select the `cloud` preset.

> ⚠️ **Privacy:** the Cloud preset sends recordings to OpenAI. Use **adult or synthetic speech only**. Do not let a real child use it, and do not say personal information. OpenAI data-retention settings cannot be guaranteed from code. Confirm them on the account.

## 3. Testing on iPhone Safari

iPhone Safari exposes the microphone only in a **secure context (HTTPS)**.

1. Put the Mac and the iPhone on the **same Wi-Fi**.
2. On the Mac, `npm run dev`. The terminal prints `Network: https://192.168.x.x:5173/`.
3. Open that address in iPhone Safari.

**Two ways to handle the certificate:**

- **Quick (self-signed):** the default. Safari warns that the connection is not private → *Show Details* → *visit this website*. It may still be limited. If the microphone permission never appears, use the next method.
- **Recommended (a trusted mkcert certificate):**
  ```bash
  brew install mkcert && mkcert -install
  mkdir -p certs
  mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 127.0.0.1 192.168.x.x   # use the Mac's LAN IP
  open "$(mkcert -CAROOT)"        # AirDrop rootCA.pem to the iPhone
  ```
  On the iPhone: *Settings → Profile Downloaded → Install*, then *Settings → General → About → Certificate Trust Settings* and **turn on full trust**. Restart `npm run dev`. A `certs/` directory is used automatically.

**What to check:**

1. In the gear panel, confirm `Secure context: true` and `getUserMedia + MediaRecorder: true`, and note `Recorder MIME` (on iPhone this is usually `audio/mp4`).
2. The first tap on a Home button asks for the microphone. Choose Allow. If it was denied: *Settings → Safari → Microphone*.
3. Turn off the mute switch and raise the volume (prompts and translations are sound). **The first tap** unlocks iOS audio playback. If it still does not play by itself, the 🔊 button is always there.
4. **Real microphone + scripted text** (check permission, MIME, and segments, without spending money): gear → *Microphone (mock preset)* → `real mic + scripted text`, still on the mock preset.
5. **The real AI path:** after the key is set, choose the `cloud` preset and speak T01–T14 as an adult.

## 3a. Local mode (ASR + LLM + TTS on the Mac)

The `local` preset **runs entirely on this Mac**: whisper.cpp (recognition) + Ollama (interpretation / translation) + macOS `say` (speech). Photo vocabulary uses a separate Ollama vision model. Card speech also uses `say`. It **never calls a paid cloud service, and a failure never quietly falls back to Cloud.** If an engine is unavailable, the error is an explicit `LOCAL_*` error.

### Install (once)

```bash
brew install ollama whisper-cpp ffmpeg
ollama serve &                       # or start the Ollama desktop app
ollama pull qwen3:8b                 # interpretation + translation (default)
ollama pull qwen3-vl:8b              # photo vocabulary. The qwen3 text model cannot see images. If memory is tight, use qwen3-vl:4b and replace the default with OLLAMA_VISION_MODEL
mkdir -p models/whisper
curl -L -o models/whisper/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
npm run local:doctor                 # check hardware, tools, models, and voices; follow the printed fixes
```

> `local:doctor` reads this Mac before it advises (measured here: Apple M4 / 32 GB / macOS 26). Speech uses the built-in zh_CN and sv_SE voices (detected automatically; if the Swedish voice is missing, download it under *System Settings → Accessibility → Spoken Content → System Voice*).

### Start and check

```bash
npm run local:start                  # terminal A: whisper-server on 127.0.0.1:8080, leave it running
npm run local:smoke                  # terminal B: synthetic-speech smoke test (no microphone)
npm run dev                          # then choose the local preset in the gear panel
```

The first request makes Ollama load the model into memory (about 8 seconds measured here). That time is stored as `modelLoadMs` and is not counted as inference. `OLLAMA_KEEP_ALIVE=30m` keeps later requests warm.

### Model choice and measurements (Apple M4, 32 GB; **synthetic** speech)

| Choice | Result |
|---|---|
| LLM default `qwen3:8b` | About 2.6 s per warm call; Swedish is usable |
| Alternative `qwen3:14b` | Better Swedish, and more likely to ask a follow-up (3 of 6 ambiguous cases were not asked; 8b missed 5). About 2× the delay (about 5.1 s). Switch with `OLLAMA_MODEL=qwen3:14b` |
| Whisper default `small` | Enough, and faster |
| `large-v3-turbo-q5_0` | Same text as small on synthetic speech, about 3× the delay. Whether to switch needs another comparison on **real adult speech** |

> Result: **8b is weak at "should I ask a follow-up".** It more often proposes a meaning and waits for confirmation. This was measured on synthetic scenarios, not on child speech.

### ⚠️ Safety: do not expose Ollama on the LAN

The engine ports on this Mac should not be reachable by other devices on the same Wi-Fi. `local:doctor` and `local:start` detect this and warn. If you see `LAN exposure`: in **Ollama App → Settings**, turn off "Expose Ollama to the network" (or unset `OLLAMA_HOST=0.0.0.0`) and restart Ollama. This project's own server binds only `127.0.0.1`. The iPhone reaches `/api` only through Vite's HTTPS proxy.

### Testing local mode on an iPhone (an **adult must speak for real**)

1. Finish the install above. Run `npm run local:start` and `npm run dev` (trusted mkcert certificate: section 3).
2. On iPhone Safari open `https://<Mac LAN IP>:5173/`. In the gear panel, tick the "adult / synthetic speech only" statement and select **local**.
3. On the Mac, confirm `npm run local:doctor` prints `LOCAL_READY` (the health panel on the `/monitor` overview also shows the local engines).
4. An **adult** speaks the list below, one item at a time, while `/monitor` is open on the Mac:
   - **L02** Chinese→Swedish: say `我想去厕所。`. The confirm screen should appear → ✅ → Swedish text, and the Swedish speech should be **audible**.
   - **L03** Swedish→Chinese: say a Swedish sentence. The recognized original, the Chinese, and the Chinese speech should appear.
   - An ambiguous sentence (`他拿走了我的那个。`): at most 3 follow-ups, and only one short question at a time.
   - Playback: confirm the iPhone can play the `audio/wav` produced by `say` (mute switch off).
   - In `/monitor`, confirm the preset is `local`, the cost is **$0** (not Unknown), and the **Cloud request count did not increase**.
5. Offline test (L07): keep the iPhone able to reach the Mac while the Mac cannot reach the internet (for example a router or hotspot with no uplink). Local mode should still finish the task. Then stop Ollama and try again. The result should be an explicit `LOCAL_*` error, and the preset should not switch to Cloud.

## 3b. Monitor dashboard `/monitor` (shared by Cloud / Local / Mock)

Open `https://localhost:5173/monitor` (on a phone, `https://<IP>:5173/monitor`). The page has: Overview (request count, success rate, latency p50/p95, comparison by stage and preset, health), Requests (server-side filter / sort / paging + a detail drawer), Tasks, Evaluation (human scores: meaning score, whether it was understood, ASR problem, UI difficulty count), and Cost (rate table, budget, export, clear). Polling is 3 / 4 / 5 seconds or paused, and it pauses when the page is hidden.

**Login:** there is no default password.

- Set `MONITOR_ADMIN_PASSWORD` in `.env` (at least 8 characters), or
- leave it empty: the first start generates a random password, **prints it once in the terminal**, and saves it to `apps/server/data/monitor-admin-password` (mode 0600).
- Login uses an HttpOnly + SameSite=Strict cookie. Five failures in a row from the same client lock that client for 60 seconds. A write from another origin is rejected.
- With `MONITOR_LOCAL_ONLY=on`, only this Mac can open the dashboard.

**Protected routes** (401 until login): `/api/monitor/*`, `/api/local/health`, `/api/events/export`, `DELETE /api/events`, `DELETE /api/monitor/data`. *Download events CSV* in the gear panel therefore also requires a `/monitor` login first.

**What is stored:** one metadata row per model call — stage, preset, model tag, duration, retry link, status / error code, token usage, cost, and the basis of that cost. **Never** audio, recognized text, clarification text, translation text, prompts, or personal data (automated tests check the database, the CSV, and every JSON route with sentinel strings). The database is `apps/server/data/telemetry.sqlite` (gitignored).

**How cost is calculated** (`apps/server/config/prices.json`, revision `2026-10-18`, reloaded automatically after an edit):

| Basis | Meaning |
|---|---|
| `reported_usage` | Token counts returned by the API × the unit price |
| `estimated` | Estimated from audio minutes (for example Cloud ASR) |
| `unknown` | Usage or a unit price is missing → shown as **Unknown**, never treated as $0 |
| `not_applicable` | Local = $0; Mock = no cost |

> The non-streaming Cloud TTS API **does not return usage**, so that cost stays Unknown. The price table was filled from known public prices and **was not checked online**. Compare it with the vendor page before you rely on it. The budget only warns. It never blocks a request.

## 3c. One desktop launcher

```bash
npm run launcher:install      # creates one "小翻译.app" on the Desktop
```

Double-click **小翻译**. It opens Terminal → starts Ollama if needed → starts whisper.cpp (and warms the model) → starts the backend and the page → opens the translator and `/monitor` together, and prints the address the iPhone should open. **Closing that Terminal window (or Ctrl-C) stops everything it started.** If the processes are already running, a second double-click only opens the two pages again. Logs are in `apps/server/data/logs/`.

> Before starting, quit any `npm run dev` or `local:start` already running inside Cursor, or the ports are taken. After the project folder moves, run `launcher:install` again.

## 3d. Reaching the Mac at home from a phone on cellular data (no extra charge)

**Recommended: Tailscale (free for personal use).** It builds an encrypted private network between the iPhone and the Mac. No router port forwarding, no public IP, no domain to buy, and the service is **not exposed to the internet**.

1. Install Tailscale on both the Mac and the iPhone and sign in with the **same account**. Keep the Mac awake (*System Settings → Lock Screen / Battery* to prevent automatic sleep).
2. In the Tailscale admin page, turn on **MagicDNS** and **HTTPS Certificates**. You get a name such as `mac-mini.xxxx.ts.net`.
3. On the Mac, use Tailscale Serve to forward local port 5173 into your private network with a **trusted HTTPS certificate**. Do not use `funnel`. That publishes the service to the internet:
   ```bash
   tailscale serve --bg https+insecure://localhost:5173
   tailscale serve status        # print the address
   ```
   (The flags differ slightly by Tailscale version. Use `tailscale serve --help`.)
4. On the iPhone, **turn Wi-Fi off and use cellular only**, confirm Tailscale is connected, then open the address below. The certificate is actually trusted, so **the iPhone does not need the mkcert certificate**, and the microphone permission works. The mode is in the address, so a refresh does not fall back to mock. Changing it once in the gear panel is also remembered on that phone.
   - Local: `https://<machine-name>.ts.net/?preset=local`
   - Cloud: `https://<machine-name>.ts.net/?preset=cloud` (the "adult / synthetic speech only" box is ticked by default)
5. If Vite reports *Blocked request. This host is not allowed*: `*.ts.net` is allowed by default. For another name, use `ALLOWED_HOSTS=name npm run dev`.

**Notes**

- Only devices signed in to your Tailscale account can connect. Do not share that account.
- The translation routes themselves have no login. **Do not** use a public-URL scheme such as a Cloudflare Quick Tunnel, ngrok, or router port forwarding. Anyone who has the URL can call your Cloud preset (**spending your money**) and reach the engines on this Mac. A public deployment needs authentication first.
- Through Tailscale Serve, the backend sees the source as 127.0.0.1, so `MONITOR_LOCAL_ONLY` **cannot** tell the phone from the Mac. `/monitor` is protected only by the admin password. Use a strong one.
- On cellular data, most of the extra Local latency is uploading the recording and downloading the speech. It is usually a few hundred milliseconds more than Wi-Fi.
- **This section was not verified on a real device** (Tailscale is not installed on this Mac). Check the command in step 3 against the help for the version you installed.

## 3e. Photo vocabulary cards

Under the two translation directions on Home there are **Photo vocabulary** and **My cards**. This feature is separate from the dialogue machine. It does not record speech, does not write evaluation events, and does not store the photo on the server as part of identification.

Identification is `POST /api/vocabulary/identify`. The request carries the current preset. `local` uses the Ollama vision model on this Mac (default `qwen3-vl:8b`; the photo exists only for that request, and a failure does not switch to the cloud). `cloud` and `mock` use the OpenAI Responses API (`store: false`). Reading a card reuses `POST /api/tts` with `zh` or `sv`, so Swedish is spoken with `en` / `ett`. `local` speech is macOS `say`. The other two presets still use cloud speech. The cloud key remains only the backend `OPENAI_API_KEY`. Optional:

| Variable | Default | Notes |
|---|---|---|
| `OLLAMA_VISION_MODEL` | `qwen3-vl:8b` | Local vision. Must be a vision model already pulled with `ollama pull`. Timeout default 120 seconds |
| `OPENAI_VISION_MODEL` | `gpt-6-luna` | Cloud vision, Responses API, must accept an image. Identification timeout is at least 45 seconds and is not shortened by a smaller `OPENAI_TIMEOUT_MS` |
| `VOCABULARY_DB_PATH` | `apps/server/data/vocabulary.sqlite` | Words and file paths for the household library. Do not mix this with the monitor database |
| `VOCABULARY_MEDIA_DIR` | `apps/server/data/vocabulary-media` | Photos and speech files. Image bytes are not stored in the database |

Identification itself does not save the photo. A card is written first into IndexedDB on this device (`kt-vocabulary`). Clearing Safari website data deletes that copy.

The card page the child sees has only category icons and photo tiles. Pairing, sync, search, dates, and delete are on the parent page: hold the small dot beside the title for about two seconds. The household passphrase appears only on that page and is at least 8 characters. Another device joins with the same passphrase and sees the same library. This passphrase is not the `/monitor` admin password, and it is not how the parent page opens. Sync does not delete the card on this device. With no network, the cards already on this device still open.

A newly photographed card receives a category in the same identification (animals, food and drink, toys, clothes, home, school, nature, vehicles, other). An uncertain result is stored as other. A category changed by hand is not overwritten. Older cards that match a common word are classified when the library opens. The rest can be identified again from the parent page. The cost is similar to taking another photo, and it is recorded under Photo Vocabulary on the monitor.

Photo Vocabulary and Translation on the Cost tab are the two halves of the same request set. Do not add them again. Identification records only the tokens the API returned. If speech synthesis does not return usage, the cost stays Unknown. A cached replay is not recorded again.

**Manual check on iPhone Safari:**

1. Mac and iPhone on the same Wi-Fi, `npm run dev`, open the HTTPS address from section 3.
2. Home can still enter Chinese→Swedish and Swedish→Chinese. The ← at the top left during a turn returns to the translator home.
3. Tap **Photo vocabulary**. It should open the rear camera directly (`capture="environment"`), not a menu of "camera / photo library" first. Photograph an object (a cup, an apple). Do not photograph a person.
4. On the preview, tap **Identify**. On success, Chinese, Swedish (with `en` / `ett` when there is an article), and two separate play buttons appear. Sound plays only after a tap.
5. Tap play again. It should not wait a long time again (the audio is cached on this card).
6. After save, the study page is full screen: a large photo, Chinese, Swedish, and **中文** / **Svenska** play buttons. Left and right arrows or a horizontal swipe change cards. ← at the top left returns to the grid. The grid is about two tiles per row. Categories are large buttons. No typing. After a refresh, the cards on this device are still there.
7. Saving the same photo again should open the existing card, not create another.
8. A face or a full-body photo should ask for a different photo, and no personal name should appear.
9. The preview after a photo can use **Choose from library** as a fallback when the camera is unavailable. Choose a JPEG, PNG, or HEIC.
10. Hold the small dot beside the title for about two seconds to open the parent page. Enter the household passphrase and tap **Sync this device**. Another device with the same passphrase should see the same card. Search, dates, editing the word, editing the category, and delete are also on this page. Delete asks for confirmation. A short tap on the dot does not open it. With the network off, cards that have not been synced still open.
11. After clearing this site's data on the iPhone, the on-device cards disappear. The copy already synced to the Mac remains unless it is deleted on the parent page.

**Manual check in a desktop browser:** opening **My cards** widens the page so the grid can use more columns. The photo page stays at phone width. Long words wrap, and buttons do not cover the photo. The real iPhone checks in this section need to be walked through on a device. Desktop width can be checked by resizing the browser.

## 4. Mock scenarios (gear → Mock scenario)

| Scenario | Steps / expected |
|---|---|
| T01 `我想去厕所。` | No clarification, **still a confirmation**. After ✅, Swedish |
| T02 three fragments | After each segment, 🎤➕. At the end, ✅ (Finished). One task, one translation |
| T03 30-second timeout | Do not press stop. Wait 30 seconds. Only this segment ends |
| T04 `他拿走了我的那个。` | One short question → answer → confirm |
| T05 three clarifications fail | After 3 questions, restart / cancel. **There is no 4th question** |
| T06 confirmation is ❌ | Correction flow. At most 2 corrections |
| T07 Swedish | Recognized original + Chinese + Chinese speech. No confirmation step |
| T08 | ⇄ during a task: a separate "switch / continue" confirmation |
| T11a/b/c | Empty ASR / network error / invalid model JSON. Recoverable |

Each new task starts again from the first line of the selected scenario.

## 5. Evaluation log and CSV

The frontend sends **metadata-only** events to `POST /api/events`. The backend checks them with a strict schema. Any extra field (such as `transcript`) is rejected. **Not recorded:** audio, recognized text, translations, prompts, or the content of the "previous message".

- Export: log in at `/monitor` first, then gear → *Download events CSV*, or `GET /api/events/export` (admin session required).
- Fields: `ts, sessionId, taskId, scenarioId, providerPreset, modelTag, version, direction, eventType, elapsedMs, segmentDurationMs, clarificationCount, stage, stageDurationMs, errorCategory, deliveryMode`.
- Also appended to `apps/server/data/events.ndjson` (gitignored; turn off with `PERSIST_EVENTS=off`).
- Besides the event names in the design document, `INTERPRETATION_READY` and `TTS_READY` were added so interpretation and TTS latency can be measured.

## 6. Layout

```
apps/web/src/
  dialogue/   machine.ts (the only state machine) types.ts selectors.ts text.ts
  audio/      recorder (real / scripted) player prompts audioStore (memory only)
  services/   apiClient (typed backend client) eventLogger runtime settings
  ui/         five main screens + busy / error / switch + adult text + developer panel
apps/server/src/
  app.ts      routes: /api/health asr interpret translate tts events; /api/monitor/* (login)
  providers/  contracts mock/ cloud/ (OpenAI) local/ (whisper.cpp + Ollama + say) registry
  telemetry/  observe (exactly one row per call) pricing db (SQLite migrations) queries export
  monitor/    auth (password, session, rate limit) routes
  evaluation/ eventStore + CSV
apps/server/scripts/  local-doctor / local-start / local-smoke / local-eval / local-e2e-http
apps/web/src/monitor/ the /monitor page (lazy-loaded; not in the child UI bundle)
packages/shared/  the three provider interfaces, LIMITS, zod schemas, Mock scripts
tests/            machine/ (state machine) integration/ (HTTP + adapters)
```

- The browser talks only to the backend. The backend picks the provider from the preset header. The preset can change only while **idle**, and it is frozen for a task.
- Every async request carries `taskId` + `requestId`. A reply that arrives after the state has moved on is ignored (leaving the state also aborts the request).
- **Local** is a real implementation (`apps/server/src/providers/local/`). If an engine is unavailable it returns a `LOCAL_*` error and **does not quietly fall back to the cloud**.

## 7. Verified / not verified

### Verified (automated, `npm run check`: typecheck, ESLint, **185 tests**, and the production build all passed)

- The state machine (T01–T13), the full Mock flow over real HTTP, and the log schema rejecting content fields (all 75 tests from v1.1 still pass).
- **Telemetry / pricing:** price calculation (Unknown is not $0, Local is $0, Mock has no cost), SQLite migration and idempotence, and `observe` writing exactly one row on success, failure, cancellation, timeout, and retry. A failure inside telemetry does not change the original result (M01–M05, M08).
- **Local adapters** (against **fake** whisper / Ollama / ffmpeg / `say`): request shape, JSON schema checks, ns→ms conversion and `modelLoadMs`, `LOCAL_*` error mapping, temporary-file cleanup, no cloud fallback, a non-loopback address rejected, and LAN-exposure detection.
- **/monitor access control** (M09): every protected route is 401 when anonymous, login rate limiting, a forged `X-Forwarded-For` does not bypass it, a cross-origin write is 403, cookie attributes, `MONITOR_LOCAL_ONLY`, and no default password.
- **Monitor data plane** (M01 / M02 / M04 / M06 / M07 / M10): Cloud and Local tasks go through the same wrapper, two concurrent sessions do not duplicate rows, filter / sort / paging, injection safety, no content sentinel in the database, the CSV, or any JSON, and export plus a confirmed clear.

### Verified on a real machine or a real engine

- **The Mac local engines really ran:** whisper.cpp (small and large-v3-turbo-q5_0), Ollama (`qwen3:8b` / `qwen3:14b`), and macOS `say` (Tingting / Alva) completed the path on this M4 / 32 GB machine with **synthetic speech** (`local:smoke`, `local:e2e`) and wrote the monitor database over real HTTP, including Local $0 and a cold start of about 8.2 s kept separate from inference time.
- **Cloud:** the Cloud flow was already confirmed on an iPhone earlier. Cloud tasks were also checked through the new telemetry with an HTTP script (2 tasks, known cost about $0.0007, TTS Unknown). **That was not an end-to-end retest on the iPhone.**
- `/monitor` login, tabs, charts, and export were checked by hand in a Chromium browser.

### ⚠️ Not verified (do not treat these as passed)

- **Local has not had an end-to-end iPhone test with a real adult speaking** (L02 / L03, the full Local iPhone flow). Only `say` synthetic speech has been used, so **local end-to-end cannot be called tested and successful**.
- Whisper accuracy on a real iPhone `audio/mp4` (AAC) recording, and whether iPhone Safari can play the WAV produced by `say`.
- Running with the internet actually disconnected (L07 is verified only at the logic layer: every local request talks only to 127.0.0.1).
- Real child speech: **never used, and it should not be used**.
- The price table was not checked online. Budget and cost are indicative only.
- Prompts use the browser `speechSynthesis`. Differences between devices were not verified.

## 8. Known limits

- The clarification counter increases when a question is **chosen to be shown** (if speech fails, the text is still shown), not when the audio finishes.
- Silence or a pause does not end a segment. Only a manual stop or the 30-second timeout does.
- Recordings stay in memory. Refreshing the page drops the current task. That is intentional. V1 does not persist it.
- The translator routes `/api/asr|interpret|translate|tts` have no authentication on the LAN (the backend listens only on `127.0.0.1`, but Vite proxies `/api` out). Only `/monitor` and the export / clear routes require an admin login. Use this on a trusted network. Do not expose it publicly.
- Local translation quality depends on an 8B-class model, especially Swedish and the "should I ask" decision. That still needs evaluation on real adult speech.
- The vitest / tinypool findings from `npm audit` affect only the development test toolchain. They are not in the runtime. `npm audit fix --force` would downgrade vitest, so it was not run.
- Production deployment (HTTPS, authentication, rate limiting) is outside V1.
