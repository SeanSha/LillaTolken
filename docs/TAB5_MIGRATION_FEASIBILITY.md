# Tab5 迁移可行性评估

评估日期：2026-10-19  
硬件目标：M5Stack Tab5 Kit（SKU K145）  
范围：只读代码与公开文档。本文没有修改应用代码，没有安装依赖，也没有创建固件工程。

结论先说：**有条件可以做**。Tab5 适合作为专用硬件客户端，现有 React / iPhone 应用保持不动。对话状态机继续用现有的 XState 实现，跑在 Node 进程里给 Tab5 用，不要在 ESP32-P4 上重写一份。第一块原型板值得买；LTE 模块现在不要买。

文中用三种标记区分证据：

- **已核实**：仓库里的文件、函数，或文末列出的官方文档。
- **推断**：由已核实事实推出来的工程判断，尚未在这块硬件上跑过。
- **未决**：必须插上 K145 才能回答的问题。

---

## 1. Executive Summary

现有系统是「浏览器里的一个状态机 + Mac 上的一个无状态 Node 后端」。翻译、澄清、确认、计数器和评估事件都由 `apps/web/src/dialogue/machine.ts` 决定。后端只提供 ASR、理解、翻译、TTS 和元数据日志。Tab5（ESP32-P4 + ESP32-C6）不能运行 React 或 Node，也不应该运行 Whisper 或 Ollama。

可行的做法是新增一个瘦客户端：

1. Tab5 负责屏幕、触摸、录音、扬声器、Wi-Fi 和重试。
2. 现有 Node 进程为这块设备再托管一份**同一个**状态机。浏览器那一份保持原样。
3. 设备上传 16 kHz 单声道 PCM WAV。后端继续用现有的 `/api/asr`、`/api/interpret`、`/api/translate`、`/api/tts`。
4. 播放走 PCM。Cloud 预设今天返回的是 MP3，这一条必须在服务端转成 WAV，不要先在芯片上做 MP3 解码。

官方资料（见第 12 节来源）已经有 Tab5 的屏幕、触摸、麦克风、扬声器和 Wi-Fi 示例。麦克风示例明确写了**麦克风和扬声器不能同时使用**，示例环形缓冲大约 11 秒、采样率 17 kHz。产品现有上限是每段 30 秒（`LIMITS.segmentSeconds`）。5–15 秒落在这块板的内存能力之内，但要自己分配线性缓冲，不能直接照抄那个 11 秒环形缓冲。

主要风险不是「芯片能不能算」，而是：屏幕驱动版本、C6 协处理器上的 Wi-Fi、汉字字形、Cloud 的 MP3，以及把今天只绑定在 `127.0.0.1` 上的无鉴权 API 暴露到局域网。

---

## 2. Existing Architecture

### 2.1 目录与边界

仓库是 npm workspaces（`package.json`）：

| 路径 | 职责 |
|---|---|
| `apps/web` | React 18 + Vite。儿童界面、录音、播放、状态机、评估事件上报 |
| `apps/server` | Express。预设路由、Cloud / Local / Mock 适配器、SQLite 遥测、`/monitor` |
| `packages/shared` | 两端共用的类型、Zod schema、限额、评估事件 schema |
| `tests/machine` | 在 Node（Vitest）里驱动同一台状态机 |
| `docs/SYSTEM_DESIGN.md` | 设计权威文档 |

浏览器和后端的分界是 `packages/shared/src/contracts.ts` 里的三个接口：`SpeechRecognizer`、`DialogueModel`、`SpeechSynthesizer`。浏览器通过 `apps/web/src/services/apiClient.ts` 的 `createApiBundle()` 用 HTTP 实现这三个接口。服务端在 `apps/server/src/providers/` 里按预设实现同一组接口。

### 2.2 前端：谁画界面，谁碰硬件

组合根在 `apps/web/src/services/runtime.ts`。它创建唯一的 `dialogueMachine`，并注入录音机、内存音频库、播放器、提示音和 `EventLogger`。

界面映射在 `apps/web/src/dialogue/selectors.ts` 的 `screenOf()`。`apps/web/src/ui/App.tsx` 按这个屏幕名渲染。具体屏幕在 `apps/web/src/ui/screens.tsx`：

| 屏幕 | 组件 | 用户动作（状态机事件） |
|---|---|---|
| 首页 | `HomeScreen` | `START_TASK`（`ZH_TO_SV` / `SV_TO_ZH`） |
| 录音 | `RecordingScreen` | `SKIP_PROMPT`、`STOP_SEGMENT`；30 秒倒计时来自 `useCountdown` |
| 继续或结束 | `SegmentDecisionScreen` | `CONTINUE_SPEAKING`、`FINISH_INPUT` |
| 忙碌 | `BusyScreen` | 无按钮；阶段由 `busyStage()` 区分 asr / interpret / translate / tts |
| 澄清 | `QuestionScreen kind="clarify"` | `START_ANSWER`、`RETRY` |
| 确认 | `QuestionScreen kind="confirm"` | `CONFIRM_YES`、`CONFIRM_NO`、`RETRY` |
| 结果 | `ResultScreen` | `DELIVERY_FINISHED`、`RETRY`、`START_TASK`、`NEW_TURN` |
| 切换方向 | `SwitchScreen` | `SWITCH_YES`、`SWITCH_NO` |
| 错误 | `ErrorScreen` | `RETRY`、`CANCEL`；文案含 `NETWORK`、`TIMEOUT` |
| 兜底 | `FallbackScreen` | `RESTART`、`CANCEL` |
| 没听清 | `AsrEmptyScreen` | `RETRY` |

大按钮是 `apps/web/src/ui/BigButton.tsx`，注释写明高度至少 64 px。`docs/UI_DESIGN_BRIEF.md` 要求主按钮至少 96 pt，图标和颜色优先于文字。这些尺寸约束对 Tab5 仍然适用，但现有布局是 iPhone 竖屏（390×844 / 375×667）。Tab5 屏是 1280×720 横屏，**不能把 React 布局原样搬过去**。

成人可读文字（转写、澄清预算、错误类别）在 `App.tsx` 的 `AdultInfo` 和各屏的 `adult-note` 里。儿童主路径不依赖阅读。

开发者设置在 `apps/web/src/ui/DevPanel.tsx`，预设记忆用 `localStorage`（`apps/web/src/services/presetPreference.ts`，键 `kt.preset`）。Tab5 不需要这份面板，也不需要 `localStorage`。

### 2.3 后端职责与端点

入口 `apps/server/src/index.ts`，路由在 `apps/server/src/app.ts` 和 `apps/server/src/monitor/routes.ts`。

翻译相关（无登录）：

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/health` | 无 | `{ ok, version, promptMemory, presets }` |
| POST | `/api/asr?language=zh\|sv` | 原始音频字节 | `{ text }` |
| POST | `/api/interpret` | JSON，`InterpretRequestSchema` | `ASK_CLARIFICATION` / `PROPOSE_MEANING` / `UNRESOLVED` |
| POST | `/api/translate` | JSON `{ text, direction, previousDelivered? }` | `{ translation }` |
| POST | `/api/tts` | JSON `{ text, language }` | 音频字节，`Content-Type` 为适配器的 `mimeType` |
| POST | `/api/events` | `{ events: EvalEvent[] }`，最多 100 条 | 204 |

必填头：`X-Provider-Preset`、`X-Task-Id`、`X-Request-Id`（正则 `^[A-Za-z0-9_.:-]{1,100}$`）。可选头：`X-Session-Id`、`X-Direction`、`X-Duration-Ms`、`X-Mock-Transcript`（仅 mock）。

监控相关在 `/api/monitor/*`，要管理员 cookie。`/api/events` 本身不要求登录；导出和删除要求登录。

默认监听 `127.0.0.1:8787`（`apps/server/src/config.ts` 的 `HOST`）。iPhone 并不直连这个端口，而是走 Vite 的 HTTPS 代理（`apps/web/vite.config.ts` 把 `/api` 转到 `127.0.0.1:8787`）。没有 CORS 中间件。浏览器能工作，是因为页面和 `/api` 同源。

### 2.4 对话状态机的位置

**状态机在浏览器里，不在后端。**

- 定义：`createDialogueMachine()`，`apps/web/src/dialogue/machine.ts`（XState v5）。
- 上下文类型：`apps/web/src/dialogue/types.ts` 的 `MachineContext`。
- 浏览器装配：`runtime.ts`。
- Node 测试已经能跑它：`tests/machine/harness.ts`、`tests/integration/server.test.ts` 都 `import` 同一函数。

机器拥有全部决策：分段、最多 3 次语义澄清、翻译前必须 `CONFIRM_YES`、最多 2 次纠正、最多 2 次空识别重试、方向切换的 `SWITCH_YES` / `SWITCH_NO`、过期请求用 `requestId` 丢弃。限额在 `packages/shared/src/types.ts`：

```ts
segmentSeconds: 30
semanticClarifications: 3
correctionAttempts: 2
asrRetries: 2
```

音频不进 XState 快照。`AudioStore`（`apps/web/src/audio/audioStore.ts`）只放在内存里。`lastDelivered` 是上一轮已送达的文本，由机器放在 context 里，下一次 interpret/translate 时作为 `previousDelivered` 发给后端。后端自己不保存对话；`PROMPT_MEMORY=off` 时还会把客户端传来的 `previousDelivered` 丢掉（`app.ts`）。

因此：**对话管理今天完全依赖浏览器侧状态。** 刷新页面会丢掉进行中的任务和 `lastDelivered`。预设选择依赖 `localStorage` 和 URL 查询参数。这不是服务端会话。

### 2.5 浏览器 API

| 能力 | 位置 | Tab5 上是否存在 |
|---|---|---|
| `navigator.mediaDevices.getUserMedia` | `MediaRecorderRecorder.openStream()` | 不存在 |
| `MediaRecorder` | `apps/web/src/audio/recorder.ts` | 不存在 |
| 安全上下文（HTTPS） | 同上；Vite 默认 HTTPS | 不适用 |
| `<audio>`、`URL.createObjectURL`、iOS `unlock()` | `apps/web/src/audio/player.ts` | 不存在 |
| `speechSynthesis` | `apps/web/src/audio/prompts.ts` 的离线兜底 | 不存在 |
| `localStorage` | `presetPreference.ts`、`settings.ts` | 不存在 |
| `fetch` + `AbortSignal` | `apiClient.ts`，默认超时 45 秒 | 要用 C/C++ HTTP 客户端重写 |
| `crypto.randomUUID` | `runtime.ts` 的 `randomId()` | 不存在；ID 可以由服务端生成 |
| Web Audio `AudioContext` | **代码里没有使用** | — |

录音约束只有回声消除和噪声抑制，**没有指定采样率**。MIME 按浏览器能力选择，顺序是 `audio/mp4`、`audio/webm;codecs=opus`、`audio/webm`、`audio/ogg;codecs=opus`。iPhone Safari 实际多为 `audio/mp4`（README 已写明）。

### 2.6 音频格式与传输

上传：`POST /api/asr`，body 是原始字节，`Content-Type` 等于录音 MIME。上限 `PAYLOAD_LIMITS.maxAudioBytes` = 10 MB。

服务端按 MIME 认扩展名（`extensionForMime()`，`apps/server/src/providers/cloud/index.ts`）：m4a、webm、ogg、wav、mp3、flac。Local ASR 再用 ffmpeg 转成 16 kHz、单声道、`pcm_s16le` WAV（`apps/server/src/providers/local/whisper.ts` 的 `convertToWav()`）。Cloud ASR 把原始容器交给 OpenAI。

TTS 返回值取决于预设：

| 预设 | MIME | 格式 | 代码 |
|---|---|---|---|
| cloud | `audio/mpeg` | MP3 | `OpenAISpeechSynthesizer`，`response_format: 'mp3'` |
| local | `audio/wav` | 16-bit PCM，`LEI16@22050` | `LocalSpeechSynthesizer`，macOS `say` |
| mock | `audio/wav` | 16 kHz 正弦波 | `makeToneWav()`，默认采样率 16000 |

提示音是 12 个静态文件：`apps/web/public/prompts/<id>-<zh|sv>.mp3`。播放失败才退回浏览器 `speechSynthesis`。

传输是 HTTPS 上的 HTTP/1.1（开发时 Vite 代理）。没有 WebSocket，没有分片上传协议。

### 2.7 会话与同步

- `sessionId`、`taskId`、`requestId` 都在浏览器生成。
- 一次任务的 `preset` 在 `START_TASK` 时冻结。
- 进行中的任务只存在于这个页面的 XState actor。
- 取消或切换方向时，`apiClient` 用 `AbortSignal` 中止 fetch；服务端在连接断开时 abort 上游（`app.ts` 的 `res_onClose`）。
- 多段录音先留在 `AudioStore`，用户点「说完了」后按顺序逐段调用 ASR。

Tab5 如果自己保存这份 context，就等于把状态机重写进固件。不需要这样做。

### 2.8 Cloud 与 Local

`apps/server/src/providers/registry.ts` 注册 `mock`、`cloud`、`local`。选择由请求头 `X-Provider-Preset` 决定，不是由客户端实现决定。

- Cloud：OpenAI ASR + Chat Completions JSON schema + TTS。密钥只在服务端。
- Local：whisper.cpp（`127.0.0.1:8080`）+ Ollama（`127.0.0.1:11434`）+ macOS `say`。失败不会偷偷改走 Cloud。
- 每次调用都经过 `observeBundle()`（`apps/server/src/telemetry/observe.ts`），往 SQLite 写一行元数据。

Tab5 只要最终仍调用这些路由，Cloud / Local 都不用搬到设备上。Local 继续要求这台 Mac 开着 whisper 和 Ollama。

### 2.9 日志、评估与错误

两条独立的记录：

1. **客户端事件**。状态机调用 `deps.log`。`EventLogger`（`apps/web/src/services/eventLogger.ts`）把字段收成 `EvalEventSchema`（`packages/shared/src/evaluation.ts`），约 400 ms 后 `POST /api/events`。schema 是 strict 的，多一个字段会被拒绝。内容（音频、转写、译文）进不了这个日志。
2. **服务端模型调用**。`observeBundle` 写 `ai_requests`。与谁发起无关，只要请求到达后端。

`/monitor`（`apps/web/src/monitor/`）读的是 SQLite，不区分「iPhone」和「别的客户端」。表结构（`apps/server/src/telemetry/db.ts`）没有 `client` 列。会话只能靠 `session_id` 区分。

错误类别（`NETWORK`、`TIMEOUT`、`RECORDER`、`ASR_EMPTY` 等）由 `AppError` 表达。界面对网络失败的呈现是 `ErrorScreen` 的「再试一次 / 取消」，对应事件 `RETRY` / `CANCEL`。

---

## 3. Reusability Matrix

| 组件 | 分类 | 原因 |
|---|---|---|
| `packages/shared` 的类型、schema、限额、评估事件 | 复用，不改行为 | 设备协议应使用同一套事件名和限额。schema 今天是 strict 的，新增字段才需要改它 |
| XState 状态机 `machine.ts` | 复用，改装配方式 | 逻辑与 DOM 无关，测试已经在 Node 里跑。给 Tab5 用时换掉 `DialogueDeps` 里的录音机和播放器。不要在 C 里再写一份 |
| 浏览器里的那份机器（`runtime.ts`） | Tab5 不需要 | iPhone 应用继续用它。两份装配可以并存 |
| React 屏幕、`BigButton`、CSS、吉祥物 | Tab5 上重写 | ESP32-P4 没有 DOM。交互种类（11 个屏幕、同样的事件）要保留，像素布局按 1280×720 重画 |
| `screenOf()` / `busyStage()` | 复用，小改 | 服务端可以用它们生成「当前该画哪一屏」。它们现在的参数类型绑在 XState 快照上，可以从 `apps/web` 调用，或把纯函数抽到 shared。抽文件是后续实现时的事，本评估不改代码 |
| `MediaRecorderRecorder` | Tab5 上重写 | 依赖 `getUserMedia` 和 `MediaRecorder` |
| `AudioPlayer`、`<audio>`、iOS unlock | Tab5 上重写 | 依赖 HTML audio。设备改用 ES8388 播 PCM |
| `SpeechPrompts` 的文案和 12 个提示音 | 复用内容，换播放器 | 文案在 `PROMPT_TEXT`。文件是 MP3。设备应使用预先转好的 WAV，或由服务端转码后下发 |
| `speechSynthesis` 兜底 | Tab5 不需要 | 板上没有浏览器语音 |
| `AudioStore` | 复用思路 | 若机器在 Node 上跑，这份内存库跟着机器留在服务端。设备上只保留「正在录的这一段」 |
| `apiClient.ts` | Tab5 不直接复用 | 设备不要自己编排 ASR→LLM→TTS。那是状态机的 actor。设备只上传音频、拉视图、拉 PCM |
| Express 路由与三个预设 | 复用，少量加接口 | 模型调用保持原路由。需要新的设备会话层，以及面向设备的 WAV 输出 |
| Cloud / Local / Mock 适配器 | 复用 | 仍在 Mac 上。Local 的 ffmpeg 转码已经能吃 WAV |
| `EventLogger` + `POST /api/events` | 复用路径 | 机器若在服务端跑，改为直接 `EventStore.add` + `db.ingestEvents`，和 `/api/events` 同一条入库路径。不要让固件自己组评估事件 |
| `/monitor` 界面 | 复用 | 两边的模型调用已经会进 `ai_requests`。对话事件只要进 `events` 表，概览、任务、人工评分都还能用 |
| `DevPanel`、预设 URL、`localStorage` | Tab5 不需要 | 预设改由设备会话的配置决定（原型可固定 `local` 或 `mock`） |
| Vite、mkcert、iOS 音频解锁 | Tab5 不需要 | 仅服务现有网页 |
| 摄像头、IMU、RS485、RTC | Tab5 不需要 | 与翻译无关。K145 上有这些硬件，第一版不要初始化它们，以减少和屏幕/音频抢带宽的风险 |

状态机对浏览器状态的依赖，集中在 `runtime.ts` 注入的四个副作用：录音、播放、提示音、`log`。机器文件本身不读 `window`。这是「把机器留在 Node、只换副作用」能够成立的原因。**推断**：把 `DialogueDeps.recorder` 换成「等设备 POST 音频才 resolve 的录音机」，现有状态迁移可以不改。这个推断要由后续的 Node 测试证明，现在还没有设备会话代码。

---

## 4. Hardware/Software Compatibility

规格来自 M5Stack 文档（2026-10-19 查阅，链接见第 12 节）。

| 项目 | 官方参数 | 对本项目的含义 |
|---|---|---|
| 主控 | ESP32-P4，RISC-V 双核 360 MHz + LP 核 40 MHz | 不能跑 Node、React、Whisper、Ollama |
| 无线 | 板载 ESP32-C6-MINI-1U，2.4 GHz Wi-Fi 6 | Wi-Fi 不在 P4 里。Arduino 示例用 SDIO 引脚 `WiFi.setPins(...)` |
| 内存 | 16 MB Flash，32 MB Octal PSRAM | 够放一帧画面和多段短音频。见下面的预算 |
| 屏 | 5 英寸 IPS，1280×720，文档写驱动为 ST7123 / ST7121 | 横屏。整帧 RGB565 约 1.84 MB |
| 触摸 | 文档写驱动集成在显示芯片里；Espressif BSP 同时列出 GT911 与 ST7123 | **未决**：买到的那一批到底是哪颗，要靠能点亮的示例确认 |
| 音频 | ES8388 编解码 + ES7210 回声消除前端，双麦克风，1 W / 8 Ω 扬声器 NS4150B | 能录能播。官方麦克风示例写明二者不能同时开 |
| 供电 | Kit 含 NP-F550，7.4 V 2000 mAh；文档给出的续航约 6 小时（亮度 50%、Wi-Fi 常开） | 够做桌面原型。儿童全天使用要另测 |
| 蜂窝 | 无调制解调器。扩展焊盘支持 Cat.M / NB-IoT / LoRaWAN 模块 | 不是 LTE。见里程碑 M7 |
| USB | Type-C USB 2.0 OTG | Mac 烧录口。下载模式：按住 Reset 直到绿灯快闪 |

### 4.1 中文与瑞典语

官方麦克风示例使用 `fonts::FreeSansBoldOblique18pt7b`。这套拉丁字库**不能**显示汉字。瑞典语的 `å ä ö` 也不能假定 FreeSans 一定覆盖，要在 M1 用真实字符串看一眼。

M5GFX 的用法是换成自带或外挂的 CJK 点阵（M5 生态里常用 `efontCN_*` 这一类）。Espressif 一侧则是 LVGL 位图字库或 FreeType。两条路都能显示 Unicode，代价是 Flash 占用和首次绘制速度。儿童按钮应继续以颜色、图标、✓ / × 为主，汉字只用于成人短句和译文。译文可能是一整句中文或瑞典语，需要自动换行，不能只做单行大字。

**推断**：16 MB Flash 放得下一份常用汉字子集加拉丁扩展。全量 CJK TTF 再加 FreeType 缓存会挤占 PSRAM，第一版不要走这条路。

### 4.2 大按钮与触摸

1280×720 上，两个并排按钮可以做到远大于现有 64 px / 96 pt 的要求。官方示例用 `M5.Touch.getCount()` 和 `wasClicked()`。多点触摸存在，本产品一次只需要一个触点。

**未决**：儿童手指在 5 英寸玻璃上的误触率、横屏握持时拇指是否够得到下方主按钮。这是 M1 的观察项，不是文档能回答的。

### 4.3 录音时长与内存

官方示例（`docs.m5stack.com` 的 Tab5 Mic）：

- 采样率常量 `17000`
- 缓冲 `256 × 720` 个 `int16`，约 360 KB
- 时长约 `184320 / 17000 ≈ 10.8` 秒，而且是环形覆盖
- 注释原文：麦克风和扬声器不能同时使用；播放前要 `M5.Mic.end()`，录音前要 `M5.Speaker.end()`

本产品的一段上限是 30 秒，不是 5 秒。用户希望的 5–15 秒是这个上限里的一段使用方式。建议设备端线性缓冲，并在 15 秒（或仍遵守机器的 30 秒）到点时主动停止。

按 16 kHz、单声道、16 bit 估算：

| 时长 | PCM 大小 |
|---|---|
| 5 秒 | 160 KB |
| 15 秒 | 480 KB |
| 30 秒（现有产品上限） | 960 KB |

32 MB PSRAM 放下一段 30 秒音频加一帧 RGB565（约 1.84 MB）仍然宽裕。风险不在总容量，而在：

- 分配必须用 PSRAM（示例用的是 `heap_caps_malloc`），不能放内部 RAM。
- 继续说下一段之前，上一段应已经上传并可以释放。机器今天允许多段后再一起识别；若 Wi-Fi 中断，设备上只应保留尚未被服务端确认的那一段。
- 录音和播放必须串行。现有机器在提示音接近结束时调用 `recorder.prepare()`，用来提前打开 iPhone 麦克风。Tab5 上这个预热会和提示音冲突，设备侧的 `prepare()` 应为空操作，等提示音播完再开麦。

采样率：示例是 17 kHz。Whisper 路径会再用 ffmpeg 重采样到 16 kHz。为了少一次无谓的重采样，设备应按 16 kHz 录，并封装成标准 WAV（44 字节头 + PCM）。`extensionForMime()` 已经认识 `wav`。**未决**：ES8388 在这块板上是否稳定接受 16000，还是必须用示例里的 17000。M2 用两种速率各录一次就能定。

### 4.4 上传、下载与播放

480 KB 的 WAV 在局域网 Wi-Fi 上很小。短句 TTS 若是 22050 Hz 单声道 16 bit、大约 5 秒，大约 220 KB，同样很小。

播放 API 方面，Arduino 示例是 `M5.Speaker.playRaw(pcm, length, sampleRate, stereo, ...)`，吃的是 PCM，不是 MP3。Local 和 Mock 已经返回 WAV。Cloud 返回 MP3。

**推断**：第一版在 Mac 上把 Cloud MP3 转成 WAV，再发给 Tab5。ESP-ADF 的 MP3 示例带有 `sdkconfig.defaults.esp32p4`，说明 P4 上解码 MP3 是有人在做的，但它不是 Tab5 BSP 的现成功能，也会和「麦克风/扬声器互斥、画面刷新」叠在一起。原型阶段不要把解码放进固件。

### 4.5 网络中断

现有网页把网络失败变成 `ErrorScreen`，用户点 `RETRY`。状态机按失败阶段回到 ASR、理解、翻译或录音（`recoverableError`）。设备可以照这个模型做：

- 上传失败：保留这一段 PCM，屏幕给出重试，不要重新录音，除非用户选择重录。
- 下载 TTS 失败：对应已有的 `audioStatus === 'failed'` 和 `RETRY`。
- 视图轮询失败：停在最后一屏，显示断线，恢复后继续问服务端要当前屏幕。
- 服务端在设备消失后必须放弃卡住的 `recorder.stop()` 等待，否则下一次会话会堵死。需要心跳或超时。今天的代码没有这个会话，这是新代码的责任。

Wi-Fi 栈跑在 C6 上，经 SDIO 连到 P4。显示走 MIPI-DSI，音频走 I2S。**未决**：录音的同时维持 Wi-Fi、或边刷新 720p 边上传，会不会爆音或断连。M3 和 M4 专门测这个，不要在 M2 里同时开 Wi-Fi 就假定没有干扰。

### 4.6 服务端可达性（和硬件同样重要）

Tab5 无法使用 Vite 代理。要让它访问现在的 Node，至少得把 `HOST` 设成这台 Mac 的局域网地址。这样做会把**没有鉴权**的 `/api/asr`、`/api/interpret`、`/api/translate`、`/api/tts`、`/api/events` 暴露给同一 Wi-Fi 上的其他人。Cloud 预设会因此把任意上传音频送到 OpenAI。这是迁移的必改项，不是固件能单独解决的。

---

## 5. Recommended Development Environment

比较的是 M5 官方现在写给 **ESP32-P4 / Tab5** 的路径，不是 ESP32-S3 的通用模板。S3 的 board、分区和 Wi-Fi 示例不能拿来用：P4 没有片内 Wi-Fi，屏是 MIPI-DSI 720p，无线要初始化 C6。

### A. Arduino + M5Unified / M5GFX

官方 Quick Start 要求：

- M5Stack 板支持包：麦克风示例 ≥ 3.2.0，Wi-Fi 示例 ≥ 3.2.2
- 开发板选择 `M5Tab5`
- M5Unified ≥ 0.2.23，M5GFX ≥ 0.2.30（文档写明：不同批次的 LCD 驱动都要靠这个版本区间）

已有示例：显示与触摸、麦克风录音并回放、Wi-Fi STA（含 `WiFi.setPins` 和板级 `BOARD_SDIO_ESP_HOSTED_*`）、天线切换。

优点：麦克风和 Wi-Fi 的引脚、互斥关系和库版本都有官方可编译片段。大色块按钮用 M5GFX 画就够原型。  
缺点：汉字要另选字库；布局是手写坐标；官方 PlatformIO 片段用的板子名是 `esp32-p4-evboard` 再加 `board_build.mcu = esp32p4`，不是一个叫 `m5stack-tab5` 的稳定板卡。Arduino 官方 core 对 P4 的支持跟随 ESP-IDF 5.4，仍比 S3 年轻。

### B. PlatformIO，在 Cursor 里写

M5 文档给出的 `platformio.ini` 是：

- `platform = https://github.com/pioarduino/platform-espressif32.git#54.03.21`
- `framework = arduino`
- `board = esp32-p4-evboard`
- `board_build.mcu = esp32p4`
- Flash 模式 `qio`，并打开 `BOARD_HAS_PSRAM`、USB CDC

`54.03.21` 对应 Arduino core 3.2.1、ESP-IDF 5.4.2（pioarduino 发行说明）。这是社区维护的 PlatformIO 平台，不是 PlatformIO 注册表里的旧版 `platformio/espressif32`。Arduino 3.x 在上游 PlatformIO 里长期缺位，所以必须用 pioarduino。社区讨论里，更早的 `#54.03.20` 曾因 esptool 参数错误导致构建失败；文档后来改到了 `54.03.21`。**应固定 release zip，不要跟踪会移动的 git 分支。**

Cursor 基于 VS Code，PlatformIO 扩展可以装。本仓库的对话和后端仍用现在的 TypeScript 工具链，固件是旁边的一个独立工程。AI 辅助改 `platformio.ini` 和少量 C++ 是现实的。扩展本身不是 Cursor 内置功能，第一次安装和 Python 环境要算进 M0。

Mac 烧录：USB-C。进下载模式的官方步骤是长按 Reset 直到绿色 LED 快闪。原生 USB CDC 在 macOS 上通常表现为 `/dev/cu.usbmodem*`。**未决**：这台 Mac 是否还要额外驱动，插上之前不能下结论。

### C. ESP-IDF + Espressif Tab5 BSP + LVGL

官方出厂固件教程指定 **ESP-IDF v5.4.2**，仓库 `m5stack/M5Tab5-UserDemo`，用 `fetch_repos.py` 拉依赖，在 `platforms/tab5` 里 `idf.py flash`。教程正文以 Ubuntu 为例，并指向 Espressif 的 Linux 与 macOS 入门。macOS 可以装，但路径和 Python 虚拟环境比 PlatformIO 更容易和本机其他项目打架。

Espressif 组件 `espressif/m5stack_tab5`（查阅时注册表可见 1.2.x）声明的能力包括：显示（文档表格里同时出现 ILI9881C 与 ST7123）、LVGL port、触摸（GT911 与 ST7123）、ES8388 扬声器、ES7210 麦克风、microSD。BSP 示例包含 LVGL 显示、以及「显示 + 音频 + 照片」。Wi-Fi 仍要单独接 `esp_wifi_remote` / hosted 协议栈，连接 C6。这块没有 M5 那个 20 行的 STA 示例那么直接。

优点：720p 界面、触摸手势、换行和字库长期更好维护；和芯片厂商的 P4 支持对齐。  
缺点：第一周会花在 CMake、`menuconfig`、组件版本和字库转换上，而不是花在「能不能录到孩子说话」。显示驱动在 M5 产品页（ST7123）和 BSP 表格（两代面板都列）之间并不干净，选错 BSP 版本会黑屏。

### 原型选型

**第一块硬件原型用 B：Cursor 里的 PlatformIO，框架是 A 的 Arduino + M5Unified / M5GFX。**

理由：

1. M0–M3 要证明的是 USB 烧录、720p 触摸、5–15 秒录音回放、以及 C6 Wi-Fi。这四件事 M5 都有现成示例，引脚也写死了。
2. ESP-IDF + LVGL 更适合在音频和网络已经跑通之后再做完整儿童界面。现在两条栈一起上，排错时分不清是面板版本、字库还是协议。
3. 状态机和 API 仍在这个 TypeScript 仓库里。固件保持薄，用 Cursor 同时看两边是合适的。PlatformIO 的单入口 `src/main.cpp` 比一套 IDF 组件树更容易审阅。
4. 若 M1 发现手头这块板的面板只有 BSP 能点亮，再把显示层换到 C。不要为了这个可能性从第一天就上 IDF。

长期（M5 之后若界面状态变多）：把绘图换成 ESP-IDF BSP + LVGL，协议层可以留着。那是一次有意的固件重写，不是原型的前置条件。

版本建议（实现时再锁定，此处只作为起点）：pioarduino `54.03.21` 的 zip、M5Unified ≥ 0.2.23、M5GFX ≥ 0.2.30、板级 USB CDC 打开、PSRAM 打开。不要使用 `board = esp32-s3-devkitc-1` 或任何 S3 分区表。

---

## 6. Proposed Architecture

```text
iPhone Safari                         Tab5 K145
React + 浏览器里的 XState             屏幕 / 触摸 / 麦 / 喇叭 / Wi-Fi
        |                                     |
        |  现有 /api/asr|interpret|           |  新的设备会话
        |       translate|tts|events          |  （视图 + 音频 + 按钮事件）
        v                                     v
        +----------------+--------------------+
                         |
                    Node on the Mac
                         |
         +---------------+----------------+
         | 现有 provider（mock/cloud/local）|
         | 给 Tab5 额外托管的同一台 XState   |
         | EventStore + telemetry.sqlite    |
         +----------------------------------+
                         |
              OpenAI    或    whisper + Ollama + say
              （仅 cloud）     （仅 local，仍只绑 127.0.0.1）
```

原则：

- **iPhone 路径一行不改也能继续用。** 浏览器继续拥有自己的状态机和 `AudioStore`。
- **Tab5 不内嵌状态机。** 它是一个渲染器和音频外设。
- **第二份状态机跑在现有 Node 进程里**，每个已配对的设备一个 actor。复用 `createDialogueMachine()`。录音机的 `stop()` 等到设备把 WAV 传上来；播放器的「播放」变成「把 PCM 放进待下发槽，等设备报告播完」。
- **模型调用不绕新协议。** 服务端 actor 直接调用已经包过 `observeBundle` 的 provider，这样 `/monitor` 的请求表、延迟和费用与网页走同一条代码。
- **评估事件不由固件组装。** actor 的 `deps.log` 在进程内写入现有 `EventStore` 和 `db.ingestEvents`。仪表盘因此同时看到网页会话和 Tab5 会话。
- **用 `sessionId` 前缀区分客户端**，例如 `tab5-...` 与网页的 UUID。这样不必先改 strict 的 `EvalEventSchema`。过滤是监控上的展示改进，可以后做。
- **音频格式在设备边界上收成 WAV PCM。** 上传：16 kHz mono s16 WAV。下发：同样是 WAV。Cloud 的 MP3 只在 Mac 上存在。
- **提示音放在设备 Flash 里的 WAV**（由现有 12 个 MP3 离线转好）。这样断网时仍能说出「出了点小问题」。动态的确认句和译文仍从服务端来。
- **传输用局域网 HTTP，短轮询即可。** 服务端今天没有 WebSocket。480 KB 上传用一次 POST 足够，不需要分片。轮询间隔 200–400 ms，只在「等待服务端进入下一屏」时进行。录音过程中不必轮询。
- **一个设备会话只保留一段未确认音频。** 服务端确认收到后再允许录下一段。这和机器「多段都留在 AudioStore」兼容：AudioStore 在服务器内存里，设备内存里只留当前段。
- **预设默认 `mock` 直到 M4，再切 `local`。** Cloud 会花钱，也多一个 MP3 转码步骤，不应作为第一块板的联调预设。

网页与 Tab5 可以同时开着，它们是两个 session。不要让两个客户端共用一个 `taskId`。

服务端绑定仍默认 `127.0.0.1`。给 Tab5 用时通过环境变量 `HOST=0.0.0.0`（或该 Mac 的局域网 IP）单独启动，并加上设备令牌。不要把 Ollama 或 whisper 绑到 `0.0.0.0`；README 已经把这件事标为安全问题，迁移不能破坏它。

---

## 7. API Changes Required

现有四个模型路由和 `/api/events` 的 JSON 形状可以不变。网页客户端继续按今天的方式调用。

需要新增的，都是**加**而不是改旧契约：

| 变更 | 原因 | 不改会怎样 |
|---|---|---|
| `HOST` 可配置为局域网（已有环境变量，默认仍是回环） | Tab5 到不了 `127.0.0.1` | 设备无法连上 |
| 设备令牌，例如 `Authorization: Bearer` 只保护 `/api/device/*` | 局域网里的 ASR 会把音频送到 Cloud | 任何同网设备都能调用 |
| `POST /api/device/sessions` | 创建服务端 actor，返回 `sessionId` | 没有地方存放机器 |
| `GET /api/device/sessions/:id` | 返回当前屏幕、成人短文、按钮列表、是否有待播放音频、错误类别 | 固件就要自己理解 XState |
| `POST /api/device/sessions/:id/events` | body 为现有 `DialogueEvent`（`START_TASK`、`STOP_SEGMENT`、`CONFIRM_YES` 等） | 无法驱动机器 |
| `PUT /api/device/sessions/:id/segment` | `audio/wav` 原始 body，在机器处于 `stopRecording` 等待时提交 | 录音无法进入 ASR |
| `GET /api/device/sessions/:id/audio` | 返回待播放 WAV，播完后设备再发 `DELIVERY_FINISHED` | 结果语音无法到达喇叭 |
| Cloud TTS 在设备路径上转成 WAV | `playRaw` 不吃 MP3 | Cloud 预设有字无声 |
| 会话心跳与超时 | 设备断电时服务端不能永远停在 `recorder.stop()` | 一次断线弄死会话 |
| 可选：`sessionId` 使用 `tab5-` 前缀 | 仪表盘区分来源，且不用放宽 `EvalEventSchema` | 两边日志混在一起，仍能用，只是分不开 |

明确不要做的：

- 不要把状态机的 context 整份同步到设备。
- 不要让设备直接调用 `/api/interpret` 和 `/api/translate` 来自己决定下一步。那样会把澄清次数和「必须确认」重新实现一遍。
- 不要为了 Tab5 改掉网页的 MP3 TTS。只在设备取音频时转码。
- 不要给 `/api/events` 增加 `client` 字段，除非同时改 Zod strict schema、CSV 列和监控 UI。前缀方案足够用于 M6。
- 监控登录仍然是浏览器 cookie。Tab5 不打开 `/monitor`。

`POST /api/events` 保持给网页。Tab5 会话的评估事件由服务端 actor 在进程内写入，这样固件崩溃也不会丢掉 `CONFIRMATION_YES` 这类事件。模型调用行则在 `observeBundle` 里，设备是否在线都不影响「这一次 ASR 花了多久」。

---

## 8. Migration Milestones

固件建议放在仓库外或 `firmware/tab5/`（尚未创建）。下面的「要创建的文件」是以后的目标，不是本评估已经做的事。每一段的烧录方式都是：USB-C 连接 Mac，必要时长按 Reset 进入下载模式，然后 PlatformIO Upload。串口日志 115200。

### M0：开发环境与硬件连接

- 工具：Cursor、PlatformIO 扩展、pioarduino 平台 zip（建议 `54.03.21`）、数据型 USB-C 线、一块 K145。
- 文件：新建 `firmware/tab5/platformio.ini`、`firmware/tab5/src/main.cpp`（只打印芯片型号和 PSRAM 大小）。不改 `apps/`。
- 烧录：`pio run -t upload`，然后串口监视。
- 测试：确认端口出现、烧录完成、复位后日志还在。拔插一次再烧。
- 期望：串口看到 ESP32-P4 与 PSRAM 约 32 MB。屏幕可以仍是出厂画面。
- 风险：下载模式没进、线只能充电、平台 tag 过期导致 esptool 报错。
- 验收：连续两次从零烧录成功，日志里的芯片是 P4 而不是 S3 或 C6。

### M1：文字与触摸

- 工具：M5Unified ≥ 0.2.23、M5GFX ≥ 0.2.30。
- 文件：只改固件的 `main.cpp`。准备一张含「说中文」「Prata svenska」「åäö」的测试画面和两个满宽按钮。
- 烧录：同 M0。
- 测试：点左钮、点右钮、点按钮之间的空白。旋转或固定为横屏一种方向，不要中途改坐标系。
- 期望：720p 全屏点亮；两个按钮 ≥ 96 px 高；中文不是方框；瑞典语附加字符正确；空白处不触发按钮。
- 风险：面板是 ST7123 还是 ILI9881C，字库没有汉字，触摸坐标镜像。
- 验收：成人能读出屏幕上的一句中文和一句瑞典语；儿童尺寸的点击（用指腹，不只是触控笔）10 次至少 9 次落在目标按钮上。

### M2：录 5 秒并回放

- 工具：同 M1。缓冲从 PSRAM 分配。
- 文件：固件内录音/播放模块。不联网。
- 烧录：同 M0。
- 测试：提示音或蜂鸣先播完，再录 5 秒，再从喇叭回放。然后把时长改到 15 秒重做。录音过程中不要初始化 Wi-Fi。分别试 16000 Hz 和示例里的 17000 Hz。
- 期望：回放能听清刚才的话；没有明显截断；15 秒不会重启。
- 风险：麦和喇叭同时打开导致失败；内部 RAM 分配失败；17 kHz 与 16 kHz 只有一个能用。
- 验收：5 秒和 15 秒各成功 3 次。日志打印缓冲字节数（5 秒应为 160000 量级，若 16 kHz mono s16）。回放期间麦克风已 `end()`。

### M3：Wi-Fi，并向 Node 发一个测试请求

- 工具：家庭 2.4 GHz Wi-Fi（先不要假设 5 GHz 可用；C6 文档写的是 2.4 GHz Wi-Fi 6）。Mac 上现有服务以 `HOST=0.0.0.0` 启动。固件里只有一个测试用的共享密钥，不要写进 git。
- 文件：固件 Wi-Fi/HTTP；服务端可以先只调用现成的 `GET /api/health`。若 health 仍无鉴权，测试只在可信局域网做，并在 M3 结束时关掉 `0.0.0.0`，除非 M4 的令牌已经加上。
- 烧录：同 M0。
- 测试：上电连接 Wi-Fi，屏幕显示 IP，请求 `http://<mac>:8787/api/health`，把 `version` 画出来。拔掉 Mac 网线或停掉服务，屏幕应显示失败而不是卡住。
- 期望：10 秒内连上，health JSON 里的 `version` 与 `packages/shared` 的 `APP_VERSION` 一致（当前代码是 `0.1.0`）。
- 风险：SDIO 引脚没按 Tab5 示例设置；路由器隔离了无线客户端；服务仍绑在 `127.0.0.1`。
- 验收：连续 5 次冷启动都能连上并完成 health。失败时有「重试」按钮，且重试不再复位整机。

### M4：上传真实录音，拿回文字和声音

- 工具：ffmpeg 已在本机（Local 模式本来就需要）。预设先用 `mock`，再切 `local`。
- 文件：固件 WAV 封装与上传；服务端设备会话的最小子集（创建会话、提交一段音频、取回 WAV）。此时可以只做「一段录音 → ASR → 翻译 → TTS」的直线，确认语音链路，完整分支放到 M5。
- 烧录：同 M0。服务端用现有 `npm run dev` 加 `HOST`。
- 测试：对麦克风说一句固定中文。Mock 预设下应看到脚本译文和蜂鸣 WAV。Local 预设下应看到真实识别和 `say` 的 WAV，喇叭播出。用 15 秒静音再测一次，应得到可理解的空识别或错误，而不是死机。
- 期望：屏幕出现译文；喇叭播放的是服务端返回的 WAV，不是 M2 的原始录音。
- 风险：WAV 头错误导致 ffmpeg 或 OpenAI 拒收；Cloud MP3 被直接送去 `playRaw`；上传时音频任务和 Wi-Fi 互相卡死。
- 验收：mock 路径 5 次全部有文字和声音。local 路径用成人声音成功 3 次。`/monitor` 里能看到对应的 ASR 与 TTS 行，预设正确，local 费用为 0。失败时 PCM 还在，重试不必重录。

### M5：完整确认流程

- 工具：同 M4。对照 `screens.tsx` 的 11 个屏幕，而不是对照 CSS。
- 文件：服务端完整设备会话（包装 `createDialogueMachine`）；固件按 `GET` 视图渲染首页、录音、继续/结束、忙碌、澄清、确认、结果、切换、错误、兜底、没听清。
- 烧录：同 M0。
- 测试：用现有 `tests/machine` 的场景在服务端先跑通「假设备」；再在板上走中文→瑞典语的确认（对 / 不对）、一次澄清、一次方向切换、一次拔电重连。
- 期望：未确认不会翻译。不对的次数到达上限后进入兜底，而不是猜一个译文。切换方向会先问 `SWITCH_YES`。
- 风险：设备上的按钮和服务端屏幕不一致；提示音和开麦重叠；轮询把上一次的 `DELIVERY_FINISHED` 发了两次。
- 验收：板上走完一条 ZH→SV 确认路径和一条 SV→ZH 直译路径。断网后点重试，任务计数器不重置，除非用户点了取消。Node 侧机器测试仍然全绿。

### M6：评估与日志

- 工具：现有 `/monitor`。不需要 Tab5 上再做仪表盘。
- 文件：服务端 actor 的 `log` 写入 `EventStore` 与 `ingestEvents`。`sessionId` 带 `tab5-` 前缀。网页路径保持 `EventLogger`。
- 烧录：若固件不组事件，M6 可以只改服务端并重启 Node。
- 测试：同一小时内，iPhone 完成一条任务，Tab5 完成一条任务。在 Requests、Tasks、Evaluation 里找到两边。给 Tab5 那条打人工分。
- 期望：阶段耗时、预设、费用和网页任务一样出现。评估事件包含 `TASK_STARTED`、`CONFIRMATION_YES` 或 `TASK_COMPLETED`。数据库里仍然没有转写文本。
- 风险：actor 在服务端打点后，网页又打一遍，导致双份事件。Tab5 路径不要再 `POST /api/events`。
- 验收：导出的 CSV 里两条会话都在，且可以用 `sessionId` 前缀分开。哨兵检查仍证明没有音频或译文入库（沿用现有测试思路）。

### M7：单独评估 LTE

- 工具：只做纸面和实验设计。不要把蜂窝模块写进 M0–M6 的 BOM。
- 文件：本文件的后续附录即可。不要改固件。
- 测试：无硬件测试，直到 Wi-Fi 原型的 M4 已通过，并且有一份真实的音频字节数和端到端延迟。
- 期望：一份「买 / 不买」的说明。
- 风险：把 Cat.M 当成 LTE。
- 验收：见第 11 节。当前判断是**先不要买**。

K145 的扩展焊盘支持的是 Cat.M、NB-IoT、LoRaWAN 这一类模块，不是板载 LTE。这些网络安全带宽低、往返延迟高，不适合 15 秒音频加上多轮确认的交互。USB-A 上外接 LTE 狗在文档里没有 Tab5 示例。蜂窝还要面对 NAT、证书和流量费。等 M4 有了真实流量和延迟，再决定是否值得做蜂窝，并且应把它当成另一个产品阶段。

---

## 9. Risks and Unknowns

| 项 | 状态 | 说明 |
|---|---|---|
| 状态机能否不改逻辑就换录音机 | 推断 | 测试里的依赖注入支持这一点。设备会话还没写，所以还不是实测 |
| 麦与喇叭互斥 | 已核实（官方示例注释） | 提示音必须播完再开麦。和 iPhone「提前打开麦克风」的优化相反 |
| 官方示例只有约 11 秒环形缓冲、17 kHz | 已核实 | 15 秒可行，但要新的线性 PSRAM 缓冲。30 秒在容量上也可行（约 960 KB） |
| 16 kHz 是否被这块 ES8388 接受 | 未决 | M2 的二元实验 |
| 面板驱动是 ST7123 还是 ILI9881C / 触摸是集成芯片还是 GT911 | 未决 | 产品页与 BSP 表格不一致。库版本必须按到手的板来钉 |
| FreeSans 不能显示中文 | 已核实（示例字库） | M1 必须换 CJK 字库后才算通过 |
| Wi-Fi 在 C6 上，经 SDIO | 已核实 | 与录音、720p 刷新并发时的稳定性未测 |
| Cloud TTS 是 MP3，播放 API 示例是 PCM | 已核实 | 原型在服务端转 WAV |
| 服务默认只听 127.0.0.1，翻译 API 无鉴权 | 已核实 | 暴露到局域网前要加设备令牌 |
| Local 引擎必须留在 Mac 的回环地址 | 已核实 | Tab5 只访问 Node，不访问 11434 / 8080 |
| ESP-ADF 能在 P4 上解 MP3 | 文档有 P4 的 sdkconfig，**未在 Tab5 上核实** | 不作为原型路径 |
| macOS 是否需要额外 USB 驱动 | 未决 | M0 |
| 儿童语音识别率 | 未验证，也不在本次范围内 | README 写明 V1 是成人 / 合成语音的可行性测试。换硬件不改变这件事 |
| 电池在「全亮 + 连续 Wi-Fi + 音频」下的续航 | 未决 | 官方约 6 小时是另一种负载 |
| 双麦克风和 AEC 对「喇叭刚播完立刻录音」的效果 | 未决 | 可能把提示音尾音录进去。M5 要听实际录音 |
| pioarduino 标签会过期 | 已看到 54.03.20 的社区构建失败 | 锁定 zip，并把能复现的版本写进 `platformio.ini` |

在买第二块板或任何射频模块之前，应用手头这一块做完的实验：

1. 官方麦克风示例能否在这台 Mac 上烧进去并回放。
2. 换成 16 kHz、15 秒线性缓冲后是否重启。
3. 官方 Wi-Fi 示例能否连上放置设备的那个房间的 2.4 GHz。
4. 哪一个库版本能同时点亮屏幕和触摸。记下面板行为，当作这块板的硬件版本记录。
5. 从 Tab5 `GET` Mac 的 `/api/health`（短时打开 `HOST`）。

这五项有任何一项失败，都不需要再买硬件，先解决工具链或网络。

---

## 10. Effort Estimate

一个人、熟悉本仓库、尚未做过 ESP32-P4。单位是人日，含排错，不含等待快递。

| 阶段 | 范围 | 主要工作在哪 |
|---|---|---|
| 环境搭建 | 1–3 人日 | M0。USB 下载模式或 pioarduino 安装失败时走到区间上沿 |
| 基础硬件验证 | 3–6 人日 | M1–M2。字库和面板版本是主要变量 |
| 网络与音频打通 | 5–10 人日 | M3–M4。含 WAV、局域网绑定、失败重试。若把 Cloud MP3 转码算进来，再加 2–4 人日 |
| 对话界面迁移 | 8–15 人日 | M5。大部分是 Node 上的会话和视图，固件是 11 个简单屏幕。状态机逻辑本身不重写 |
| 测试与稳定 | 4–8 人日 | M6 加上断网、重复点击、麦/喇叭切换、和 iPhone 同时使用 |
| 合计到可用原型 | **21–42 人日** | 大约 4–8 个日历周。不要按「把 React 编译到板子上」估算，那条路不存在 |
| LTE 评估 | 1–2 人日纸面；若真做模块再加 5–15 人日且很可能否决 | 单独阶段 |

M5 的上限来自会话协议和「机器在服务端、音频在设备上」的时序，不是来自画按钮。先用 `tests/machine` 的假录音机把协议跑绿，再上板，可以把硬件等待从开发关键路径里拿掉。

---

## 11. Purchase Recommendation

**可以买一块 Tab5 Kit K145**，用它做 M0–M4。Kit 比单板多一块电池，方便离开 USB 调试电源，但仍要留着 USB-C 烧录。

现在不要买：

- LTE / 4G 模块、SIM 卡或天线。板上没有 LTE 调制解调器；扩展口是 Cat.M / NB-IoT / LoRa 一类，不适合这段交互式音频。
- 第二块 Tab5。在 M2 和 M3 通过之前，第二块解决不了驱动和 Wi-Fi 问题。
- 外接麦克风或喇叭。先用板载的双麦和 NS4150B。M2 失败再考虑 3.5 mm 耳机只是为了把「功放坏了」和「固件没声」分开，那是调试配件，不是产品路径。
- microSD，除非 M1 证明字库放不进 16 MB Flash。

购买前可以只做文档和协议设计。购买后的第一周只做第 9 节的五项实验。五项里 Wi-Fi 或录音失败，就停止服务端会话开发，先把硬件问题记下来。

数据型 USB-C 线如果盒子里没有，需要另备一根。仅充电的线会让 M0 看起来像「板子坏了」。

---

## 12. Go / No-Go Decision

**有条件通过（Conditional Go）。**

通过的范围：

- 保留现有 React / iPhone 应用和现有 Node 预设。
- 增加一个 Tab5 瘦客户端。
- 对话状态机仍是 `apps/web/src/dialogue/machine.ts` 这一份，由 Node 为设备再跑一个 actor。
- 第一原型工具链是 Cursor + PlatformIO（pioarduino）+ M5Unified / M5GFX。
- 先买一块 K145。

不通过的范围：

- 在 Tab5 上运行现有前端或后端。
- 在固件里重写一套澄清 / 确认状态机。
- 把 Whisper、Ollama 或 OpenAI 密钥放到设备上。
- 在 M4 通过之前购买蜂窝硬件。
- 用 ESP32-S3 的工程设置去配这块 P4。

进入固件开发的条件：接受服务端要新增设备会话和设备令牌，并接受 Cloud 语音在设备路径上转成 WAV。若不能接受把 Node 短暂暴露在局域网（即使有令牌），则这次迁移应停止在 M2，Tab5 只能当离线录音机，不能当翻译器。

---

## 来源

代码（本仓库，评估时工作区中的版本）：

- `apps/web/src/dialogue/machine.ts`、`types.ts`、`selectors.ts`
- `apps/web/src/services/runtime.ts`、`apiClient.ts`、`eventLogger.ts`、`presetPreference.ts`
- `apps/web/src/audio/recorder.ts`、`player.ts`、`audioStore.ts`、`prompts.ts`
- `apps/web/src/ui/App.tsx`、`screens.tsx`、`BigButton.tsx`、`hooks.ts`
- `apps/server/src/app.ts`、`index.ts`、`config.ts`
- `apps/server/src/providers/cloud/index.ts`、`local/whisper.ts`、`local/tts.ts`、`mock/index.ts`
- `apps/server/src/telemetry/observe.ts`、`db.ts`
- `packages/shared/src/types.ts`、`contracts.ts`、`evaluation.ts`
- `tests/machine/harness.ts`
- `README.md`、`docs/UI_DESIGN_BRIEF.md`

外部文档（2026-10-19 查阅）：

- M5Stack Tab5 产品页与规格：<https://docs.m5stack.com/en/core/Tab5>
- Tab5 Arduino 麦克风示例：<https://docs.m5stack.com/en/arduino/m5tab5/mic>
- Tab5 Arduino Wi-Fi 示例：<https://docs.m5stack.com/en/arduino/m5tab5/wifi>
- Tab5 ESP-IDF 出厂固件编译（ESP-IDF v5.4.2）：<https://docs.m5stack.com/en/esp_idf/m5tab5/userdemo>
- Espressif BSP `espressif/m5stack_tab5`：<https://components.espressif.com/components/espressif/m5stack_tab5>
- BSP 源码目录：<https://github.com/espressif/esp-bsp/tree/master/bsp/m5stack_tab5>
- pioarduino 54.03.21（Arduino 3.2.1 / ESP-IDF 5.4.2）：<https://github.com/pioarduino/platform-espressif32/releases/tag/54.03.21>
