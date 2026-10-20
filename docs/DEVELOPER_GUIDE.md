# 开发说明

项目概览和界面在仓库首页 [`README.md`](../README.md)。本文是安装、配置、手机测试和监控的操作说明。

# 小翻译 · Lilla Tolken — Minimal V1(v1.2:Cloud + Mac 本地 + /monitor 监控)

面向学龄前儿童的**中文 ↔ 瑞典语**按键说话(push-to-talk)翻译器原型。
**V1 只用于成人 / 合成语音的可行性测试**,不是儿童可用性研究,也不证明儿童语音识别准确率。

唯一权威的设计文档:[`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md)。

- **一个** React 界面 + **一个** XState v5 状态机 + 可互换的 `mock` / `cloud` / `local` 提供方。
- 中文 → 瑞典语:录音 → 识别 → 理解 → 必要时澄清(最多 3 个问题)→ **必须确认意思** → 翻译 → 瑞典语文字 + 语音。
- 瑞典语 → 中文:录音 → 识别 → 直接翻译 → 显示瑞典语识别原文 + 中文译文 + 中文语音。

## 1. 快速开始

需要 **Node.js ≥ 22.13**(监控库使用内置 `node:sqlite`;已在 Node 23.9 测试)。

```bash
npm install
npm run dev          # 同时启动后端 (127.0.0.1:8787) 与前端 (https://localhost:5173)
```

不配置任何密钥即可使用 **mock** 预设,完全离线、结果可预测。

- 桌面快速试用:`HTTPS=off npm run dev`,打开 <http://localhost:5173>(localhost 本身是安全上下文,麦克风也可用)。
- 点右上角 ⚙ 打开开发者面板:选择 Mock 场景、切换预设、导出 CSV。
- 主页点 🇨🇳🎤➜🇸🇪 或 🇸🇪🎤➜🇨🇳 开始。Mock 预设默认使用**模拟麦克风**:无需真的说话,点 ⏹ 即可,"听到"的内容来自所选场景的脚本。

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 后端 + 前端(热更新) |
| `npm run check` | 类型检查 + lint + 全部测试 + 构建 |
| `npm test` | 仅运行测试(vitest) |
| `npm run typecheck` / `npm run lint` | 单独检查 |
| `npm run check:cloud` | 用**合成文本**对 OpenAI 做冒烟测试(需要 key,会产生少量费用) |
| `npm run local:doctor` | 检测这台 Mac(芯片/内存/磁盘)、工具、模型、引擎状态,并给出下一步 |
| `npm run local:start` | 启动 whisper.cpp 服务(仅 127.0.0.1)并检查 Ollama |
| `npm run local:smoke` | 用 macOS `say` 生成的**合成语音**跑一遍 本地 ASR→理解→翻译→TTS |
| `npm run local:eval -- --help` | 在固定的成人/合成场景集上对比本地模型 |
| `npm run local:e2e -- --url http://127.0.0.1:8787 --preset local` | 经真实 HTTP(同浏览器路径)跑完整任务并写入 /monitor;`--preset cloud` 需要再加 `--allow-cloud`(会花钱) |

## 2. 配置 OpenAI API Key(Cloud 预设)

密钥**只在后端**读取,浏览器永远拿不到。

```bash
cp .env.example .env
# 编辑 .env,至少填:
OPENAI_API_KEY=sk-...
```

`.env` 在仓库根目录,已被 `.gitignore` 忽略。修改后重启 `npm run dev`。可选项见 [`.env.example`](../.env.example):

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENAI_ASR_MODEL` | `gpt-4o-transcribe` | 语音识别 |
| `OPENAI_LLM_MODEL` | `gpt-4.1-mini` | 理解 + 翻译(严格 JSON schema) |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-4o-mini-tts` / `alloy` | 语音合成(mp3,iOS 可播放) |
| `OPENAI_LLM_TEMPERATURE` | `0` | 对不支持 `temperature` 的推理模型请**留空** |
| `PROMPT_MEMORY` | `on` | 是否把"上一条已送达消息"作为可选上下文发给 LLM;Cloud/Local 对比时保持一致 |

> 默认模型 ID 是按写代码时的认知设置的,**我没有用真实账号验证它们当前对你的账号可用**。如果报错,请在 `.env` 中改成你账号可用的模型。模型与提示词版本会写入评估日志的 `modelTag`,保证成人测试可复现。

**验证 Cloud**:

```bash
npm run check:cloud
```

它会依次执行 TTS(中)→ ASR(中)→ 理解 → 翻译(中→瑞)→ TTS(瑞)→ ASR(瑞)→ 翻译(瑞→中),全部使用合成文本,并打印每步耗时。没有 key 时输出 `SKIPPED` 并以退出码 2 结束(**不代表通过**)。然后在 ⚙ 面板勾选"仅限成人/合成语音"声明,再选择 `cloud` 预设。

> ⚠️ **隐私**:Cloud 预设会把录音发送到 OpenAI。只使用**成人或合成语音**,不要让真实儿童使用,也不要说个人信息。OpenAI 的数据保留设置无法通过代码保证,请在账号侧确认。

## 3. 在 iPhone Safari 上测试

iPhone Safari 只在**安全上下文(HTTPS)**里开放麦克风。

1. Mac 和 iPhone 连**同一个 Wi-Fi**。
2. 在 Mac 上 `npm run dev`。终端会打印 `Network: https://192.168.x.x:5173/`。
3. iPhone Safari 打开该地址。

**证书有两种方式:**

- **快速(自签名)**:默认方式。Safari 会警告"此连接不是私密连接" → *显示详细信息* → *访问此网站*。可能仍受限,若麦克风不弹授权,请用下面的方式。
- **推荐(mkcert 受信证书)**:
  ```bash
  brew install mkcert && mkcert -install
  mkdir -p certs
  mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 127.0.0.1 192.168.x.x   # 换成 Mac 的局域网 IP
  open "$(mkcert -CAROOT)"        # 把 rootCA.pem 用 AirDrop 发到 iPhone
  ```
  iPhone:*设置 → 已下载描述文件 → 安装*;再到 *设置 → 通用 → 关于本机 → 证书信任设置* 里**开启完全信任**。之后重启 `npm run dev`,存在 `certs/` 时会自动使用。

**测试要点:**

1. 先 ⚙ 面板确认 `Secure context: true`、`getUserMedia + MediaRecorder: true`,并记下 `Recorder MIME`(iPhone 通常是 `audio/mp4`)。
2. 首次点主页大按钮会触发麦克风授权,选"允许"。若误点拒绝:*设置 → Safari → 麦克风*。
3. 关闭静音拨片、调高音量(提示音和翻译都靠声音)。**第一次点击**用于解锁 iOS 音频播放;如果仍不自动播放,界面上始终有 🔊 手动播放按钮。
4. **真实麦克风 + 脚本文本**(检查权限、MIME、分段,不花钱):⚙ → *Microphone (mock preset)* 选 `real mic + scripted text`,仍用 mock 预设。
5. **真实 AI 全链路**:配置好 key 后选 `cloud` 预设,用成人真实说话测试 T01–T14。

## 3a. 本地模式(Mac 上的 ASR + LLM + TTS)

`local` 预设**完全在这台 Mac 上运行**:whisper.cpp(识别) + Ollama(理解/翻译) + macOS `say`(语音)。拍照识字用另一个 Ollama 视觉模型,词卡朗读也走 `say`。它**不会调用任何付费云服务,失败时也绝不会悄悄回退到 Cloud**——引擎不可用就明确报 `LOCAL_*` 错误。

### 安装(只需一次)

```bash
brew install ollama whisper-cpp ffmpeg
ollama serve &                       # 或启动 Ollama 桌面 App
ollama pull qwen3:8b                 # 理解 + 翻译(默认)
ollama pull qwen3-vl:8b              # 拍照识字。qwen3 文字模型不能看图;内存紧可以用 qwen3-vl:4b,并用 OLLAMA_VISION_MODEL 换掉默认值
mkdir -p models/whisper
curl -L -o models/whisper/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
npm run local:doctor                 # 检查硬件、工具、模型、语音;按提示修正
```

> `local:doctor` 会先读取你的 Mac 配置再给建议(本机实测:Apple M4 / 32 GB / macOS 26)。语音使用系统自带的 zh_CN 与 sv_SE 声音(自动探测;如果瑞典语声音缺失,到 *系统设置 → 辅助功能 → 朗读内容 → 系统语音* 下载)。

### 启动与验证

```bash
npm run local:start                  # 终端 A:启动 whisper-server (127.0.0.1:8080),保持运行
npm run local:smoke                  # 终端 B:合成语音烟雾测试(不用麦克风)
npm run dev                          # 然后在 ⚙ 里选择 local 预设
```

首个请求会让 Ollama 把模型加载进内存(实测约 8 秒);它被单独记为 `modelLoadMs`,不计入推理耗时。`OLLAMA_KEEP_ALIVE=30m` 使之后保持热状态。

### 模型选择与实测(Apple M4, 32 GB;**合成**语音)

| 选择 | 结果 |
|---|---|
| LLM 默认 `qwen3:8b` | 热启动约 2.6 s/次;瑞典语可用 |
| 备选 `qwen3:14b` | 瑞典语更好、更会追问(6 个含糊用例中 3 个未追问,8b 是 5 个),但约 2× 延迟(约 5.1 s)。用 `OLLAMA_MODEL=qwen3:14b` 切换 |
| Whisper 默认 `small` | 够用、较快 |
| `large-v3-turbo-q5_0` | 在合成语音上文字与 small 相同,但延迟约 3×;要不要换需要用**成人真实语音**再比 |

> 结论:**8b 对"该不该追问"的判断偏弱**——它更容易直接给出意思让你确认。这是在合成场景上的测量,不是儿童数据。

### ⚠️ 安全:不要让 Ollama 暴露到局域网

本机引擎的端口不应被同一 Wi-Fi 的其他设备访问。`local:doctor` / `local:start` 会检测并警告。如果看到 `LAN exposure`:在 **Ollama App → Settings → 关闭 "Expose Ollama to the network"**(或取消 `OLLAMA_HOST=0.0.0.0`)并重启 Ollama。本项目自己的服务只绑定 `127.0.0.1`,iPhone 只通过 Vite 的 HTTPS 代理访问 `/api`。

### iPhone 测试本地模式(必须用**成人真实说话**)

1. 完成上面的安装,`npm run local:start` + `npm run dev`(mkcert 受信证书见第 3 节)。
2. iPhone Safari 打开 `https://<Mac 局域网 IP>:5173/`,⚙ → 勾选"仅成人/合成语音"声明 → 预设选 **local**。
3. 在 Mac 上确认 `npm run local:doctor` 显示 `LOCAL_READY`(`/monitor` 概览页的健康面板也会显示本地引擎状态)。
4. 按下面清单由**成人**真实说话,逐项记录(同时在 Mac 上开着 `/monitor`):
   - **L02** 中文→瑞典语:说 `我想去厕所。`,应出现确认屏 → ✅ → 得到瑞典语文字,并能**听到**瑞典语语音。
   - **L03** 瑞典语→中文:说一句瑞典语,应显示识别原文 + 中文 + 中文语音。
   - 含糊句(`他拿走了我的那个。`):应最多追问 3 次且只有一个简短问题。
   - 播放:确认 iPhone 能播放 `say` 生成的 `audio/wav`(静音拨片关闭)。
   - 在 `/monitor` 里确认该预设是 `local`、成本是 **$0**(不是 Unknown),且 **Cloud 请求数没有增加**。
5. 离线测试(L07):让 Mac 无法访问互联网但 iPhone 仍能连到 Mac(例如用不接入宽带的路由器/热点),本地模式应照常完成任务。另外停掉 Ollama 再试一次,应看到明确的 `LOCAL_*` 错误,而不是切到 Cloud。

## 3b. 监控面板 `/monitor`(Cloud / Local / Mock 共用)

打开 `https://localhost:5173/monitor`(手机上是 `https://<IP>:5173/monitor`)。页面包含:概览(请求数、成功率、延迟 p50/p95、按阶段/预设对比、健康状态)、Requests(服务端过滤/排序/分页 + 详情抽屉)、Tasks、Evaluation(人工评分:意思分数、是否被理解、ASR 问题、UI 困难数)、Cost(单价表、预算、导出、清空数据)。轮询 3/4/5 秒或暂停,页面不可见时自动暂停。

**登录**:没有任何默认密码。

- 在 `.env` 里设置 `MONITOR_ADMIN_PASSWORD`(至少 8 个字符),或
- 留空:首次启动时随机生成一个密码,**只在终端打印一次**,并保存到 `apps/server/data/monitor-admin-password`(权限 0600)。
- 登录用 HttpOnly + SameSite=Strict Cookie;同一客户端连续 5 次失败会被锁定 60 秒;非同源的写请求会被拒绝。
- `MONITOR_LOCAL_ONLY=on` 时只有这台 Mac 本身能打开面板。

**受保护的路由**(未登录一律 401):`/api/monitor/*`、`/api/local/health`、`/api/events/export`、`DELETE /api/events`、`DELETE /api/monitor/data`。因此 ⚙ 面板里的 *Download events CSV* 现在也需要先在 `/monitor` 登录。

**记录什么**:每次模型调用一行元数据——阶段、预设、模型标签、耗时、重试关系、状态/错误码、token 用量、费用及其依据。**绝不**记录音频、识别文本、澄清文本、翻译文本、提示词或个人数据(自动化测试用哨兵字符串检查了数据库、CSV 与全部 JSON 接口)。数据库是 `apps/server/data/telemetry.sqlite`(已被 git 忽略)。

**费用如何计算**(`apps/server/config/prices.json`,修订 `2026-10-18`,修改后自动热加载):

| 依据 | 含义 |
|---|---|
| `reported_usage` | 用 API 返回的 token 数 × 单价 |
| `estimated` | 按音频分钟估算(如 Cloud ASR) |
| `unknown` | 缺少用量或单价 → 显示 **Unknown**,不会当作 $0 |
| `not_applicable` | Local = $0;Mock = 无费用 |

> Cloud TTS 的非流式接口**不返回用量**,所以它永远是 Unknown。价格表是我按已知公开价格填写的,**没有联网核对**:使用前请对照厂商页面检查。预算只告警,从不阻止请求。

## 3c. 桌面一键启动

```bash
npm run launcher:install      # 在桌面生成 "小翻译 启动.app"、"小翻译 监控.app"、"小翻译 停止.app"
```

双击 **小翻译 启动**:自动打开 Terminal → 必要时启动 Ollama → 启动 whisper.cpp(预热模型)→ 启动后端 + 网页 → 打开浏览器,并打印 iPhone 要访问的地址。**关闭那个 Terminal 窗口(或 Ctrl-C)就会停止它启动的全部程序**。程序已在运行时,再次双击只会打开浏览器。**小翻译 监控** 直接打开 `/monitor` 监控面板(程序没运行时会先启动再打开)。**小翻译 停止** 用来强制停止 8787/5173 端口和 whisper 服务(Ollama 不会被关闭)。日志在 `apps/server/data/logs/`。

> 启动前请先退出 Cursor 里正在跑的 `npm run dev`/`local:start`,否则端口被占用。移动项目文件夹后需要重新运行 `launcher:install`。

## 3d. 在户外用手机流量访问家里的 Mac(不花钱)

**推荐:Tailscale(个人免费)。** 它在 iPhone 和 Mac 之间建立加密的私有网络:无需路由器端口转发、无需公网 IP、无需买域名,也**不会把服务暴露到互联网**。

1. Mac 和 iPhone 都安装 Tailscale,用**同一个账号**登录。Mac 保持开机、不休眠(*系统设置 → 锁定屏幕/电池* 里防止自动睡眠)。
2. Tailscale 管理页开启 **MagicDNS** 与 **HTTPS Certificates**,得到形如 `mac-mini.xxxx.ts.net` 的名字。
3. 在 Mac 上用 Tailscale Serve 把本机的 5173 以**受信任的 HTTPS 证书**转发到你的私有网络(不要用 `funnel`,那会公开到互联网):
   ```bash
   tailscale serve --bg https+insecure://localhost:5173
   tailscale serve status        # 查看地址
   ```
   (参数写法随 Tailscale 版本略有不同,以 `tailscale serve --help` 为准。)
4. iPhone **关闭 Wi-Fi、只用移动网络**,打开 Tailscale 确认已连接,然后访问下面的地址。因为证书是真正受信任的,**不再需要在 iPhone 上安装 mkcert 证书**,麦克风也能正常授权。模式写在地址里,刷新不会回到 mock;在 ⚙ 里改一次也会记在这台手机上。
   - Local:`https://<机器名>.ts.net/?preset=local`
   - Cloud:`https://<机器名>.ts.net/?preset=cloud`(「仅成人/合成语音」默认已勾选,打开即可使用)
5. 如果 Vite 报 *Blocked request. This host is not allowed*:`*.ts.net` 已默认放行;其他域名用 `ALLOWED_HOSTS=name npm run dev`。

**注意**

- 只有登录了你 Tailscale 账号的设备能访问;不要把 Tailscale 账号共享给别人。
- 翻译接口本身没有登录。因此**不要**用 Cloudflare Quick Tunnel、ngrok 或路由器端口转发这类"公开网址"方案:任何拿到网址的人都能调用你的 Cloud 预设(**花你的钱**)并访问本机引擎。要公开使用必须先加认证。
- 通过 Tailscale Serve 访问时,后端看到的来源地址是 127.0.0.1,所以 `MONITOR_LOCAL_ONLY` **无法**区分手机与 Mac;`/monitor` 仅靠管理员密码保护——请使用强密码。
- 手机流量下 Local 的延迟主要是上传录音 + 返回语音,通常比 Wi-Fi 多几百毫秒。
- **这一节我没有在真机上验证**(这台 Mac 上没有安装 Tailscale)。第 3 步的命令请以你安装的版本的帮助为准。

## 3e. 拍照识字词卡

首页在原来的两个翻译方向下面,增加 **拍照识字** 和 **我的词卡**。这条功能和对话状态机分开:不录音、不写评估事件、也不把照片存到服务器。

识别走 `POST /api/vocabulary/identify`。请求带上当前预设:`local` 用本机 Ollama 视觉模型(默认 `qwen3-vl:8b`,照片只留在这一次请求里,失败不会改走云端);`cloud` 和 `mock` 用 OpenAI Responses API(`store: false`)。朗读复用已有的 `POST /api/tts`,并带上 `zh` 或 `sv`,所以瑞典语会读出 `en`/`ett`。`local` 的朗读是 macOS `say`;另外两种预设仍用云端语音。云端密钥仍只在后端的 `OPENAI_API_KEY`。可选:

| 变量 | 默认 | 说明 |
|---|---|---|
| `OLLAMA_VISION_MODEL` | `qwen3-vl:8b` | 本地识图。必须是已经 `ollama pull` 的视觉模型。超时默认 120 秒 |
| `OPENAI_VISION_MODEL` | `gpt-4.1-mini` | 云端识图,必须支持图像输入。识别超时至少 45 秒,不受更短的 `OPENAI_TIMEOUT_MS` 影响 |
| `VOCABULARY_DB_PATH` | `apps/server/data/vocabulary.sqlite` | 家庭词库的词语和文件路径。不要和监控库混用 |
| `VOCABULARY_MEDIA_DIR` | `apps/server/data/vocabulary-media` | 照片和朗读文件。数据库里不放图片字节 |

识别本身不保存照片。词卡先写在这台设备的 IndexedDB(`kt-vocabulary`)里。清除 Safari 网站数据会删掉这一份。

孩子看到的词卡页只有分类图标和照片格子。配对、同步、搜索、日期和删除在家长页:按住标题旁的小圆点大约两秒。家庭口令只出现在这一页,至少 8 个字符。另一台设备用同一个口令加入,看到的是同一份。这个口令不是 `/monitor` 的管理密码,也不是打开家长页的方法。同步不会自动删除本机卡片。没网时仍然打开本机的卡片。

新拍的卡片会在同一次识别里带上分类(动物、食物和饮料、玩具、衣服、家居、学校、自然、交通工具、其他)。认不准时记为其他。已经手动改过的分类不会被自动盖掉。旧卡片里能对上常见词的,会在打开词库时归类;其余可以在家长页里选择再识别,费用和再拍一张相近,记在监控的 Photo Vocabulary。

监控页 Cost 里的 Photo Vocabulary 和 Translation 是同一批请求的两半,不要再加一遍。识别只记录接口返回的 token。朗读如果接口没有返回用量,费用保持 Unknown。缓存的重播不会再记一条。

**iPhone Safari 手测:**

1. Mac 与 iPhone 同一 Wi-Fi,`npm run dev`,用第 3 节的 HTTPS 地址打开。
2. 首页仍能进入中文→瑞典语和瑞典语→中文;中途点左上角 ← 可回到翻译首页。
3. 点 **拍照识字**。应直接打开后置相机(`capture="environment"`),而不是先进入带「拍照 / 从相册选」的菜单。拍一个物品(杯子、苹果),不要拍人。
4. 看到预览后点 **认一认**。成功时出现中文、瑞典语(有冠词时是 `en`/`ett`)和两个分开的播放按钮。声音只在点击后播放。
5. 再点一次播放,不应再次长时间等待(音频已缓存在这张卡片上)。
6. 保存后进入整页学习:大图、中文、瑞典语,以及 **中文** / **Svenska** 两个播放按钮。左右箭头或横滑可换卡,左上角 ← 回到格子。格子大约一行两张。分类是大按钮,不需要打字。刷新后本机卡片还在。
7. 同一张照片再保存一次,应打开已有卡片,而不是新建一张。
8. 拍一张人脸或全身照,应要求换一张,并且不出现人名。
9. 拍完后的预览页可以点 **从相册选**,作为相机不可用时的后备。选一张 JPEG/PNG/HEIC。
10. 按住标题旁的小圆点约两秒,打开家长页。在那里输入家庭口令并点 **同步本机**。另一台用同一个口令,应看到同一张卡。搜索、日期、改词、改分类和删除也在这一页。删除前要确认。短按小圆点不会打开。断网时仍能打开还没同步的本机卡片。
11. 在 iPhone 上清除该网站数据后,本机词卡消失。已经同步到 Mac 的那一份还在,除非在家长页删掉。

**桌面浏览器手测:** 打开 **我的词卡** 时页面变宽,格子能多列。拍照那一页仍保持手机宽度。长单词换行,按钮不盖住照片。这一节的真机 iPhone 需要你自己按上面的清单看;桌面宽度用浏览器缩放即可。

## 4. Mock 场景(⚙ → Mock scenario)

| 场景 | 步骤 / 预期 |
|---|---|
| T01 `我想去厕所。` | 不澄清,**仍然确认**;点 ✅ 后得到瑞典语 |
| T02 三段碎片 | 每段后点 🎤➕,最后点 ✅(Finished);一个任务、一次翻译 |
| T03 30 秒超时 | 不点停止,等 30 秒,只结束这一段 |
| T04 `他拿走了我的那个。` | 问一个短问题 → 回答 → 确认 |
| T05 三次澄清失败 | 问满 3 次后进入"重来/取消",**没有第 4 个问题** |
| T06 确认选 ❌ | 纠正流程;最多 2 次纠正 |
| T07 瑞典语 | 识别原文 + 中文 + 中文语音,无确认步骤 |
| T08 | 任务中点 ⇄:独立的"切换/继续"确认 |
| T11a/b/c | ASR 为空 / 网络错误 / 模型 JSON 异常,可恢复 |

每次开始新任务都会从所选场景的第一句重新播放。

## 5. 评估日志与 CSV

前端把**仅元数据**事件发给 `POST /api/events`;后端用严格 schema 校验,任何多余字段(如 `transcript`)都会被拒绝。**不记录**音频、识别文本、翻译、提示词或"上一条消息"内容。

- 导出:先在 `/monitor` 登录,再用 ⚙ → *Download events CSV* 或 `GET /api/events/export`(需要管理员会话)。
- 字段:`ts, sessionId, taskId, scenarioId, providerPreset, modelTag, version, direction, eventType, elapsedMs, segmentDurationMs, clarificationCount, stage, stageDurationMs, errorCategory, deliveryMode`。
- 同时追加写入 `apps/server/data/events.ndjson`(已被忽略,`PERSIST_EVENTS=off` 关闭)。
- 除设计文档里的事件名外,额外加了 `INTERPRETATION_READY` 和 `TTS_READY`,用于统计理解/TTS 的延迟。

## 6. 结构

```
apps/web/src/
  dialogue/   machine.ts(唯一状态机) types.ts selectors.ts text.ts
  audio/      recorder(真实/脚本) player prompts audioStore(仅内存)
  services/   apiClient(类型化后端客户端) eventLogger runtime settings
  ui/         五个主屏 + 忙碌/错误/切换屏 + 成人文本面板 + 开发者面板
apps/server/src/
  app.ts      路由: /api/health asr interpret translate tts events;/api/monitor/*(需登录)
  providers/  contracts mock/ cloud/(OpenAI) local/(whisper.cpp + Ollama + say) registry
  telemetry/  observe(每次调用恰好一行) pricing db(SQLite 迁移) queries export
  monitor/    auth(密码、会话、限流) routes
  evaluation/ eventStore + CSV
apps/server/scripts/  local-doctor / local-start / local-smoke / local-eval / local-e2e-http
apps/web/src/monitor/ /monitor 面板(懒加载,不影响儿童界面的包)
packages/shared/  三个提供方接口、LIMITS、zod schema、Mock 脚本
tests/            machine/(状态机) integration/(HTTP + 适配器)
```

- 浏览器只和后端通信;后端按请求头里的预设选择提供方。预设只能在**空闲**时更改,任务内冻结。
- 所有异步请求带 `taskId` + `requestId`;过期的回包被忽略(状态机退出该状态时也会中止请求)。
- **Local** 是真实现(`apps/server/src/providers/local/`):引擎不可用时返回 `LOCAL_*` 错误,**不会悄悄回退到云端**。

## 7. 已验证 / 未验证

### 已验证(自动化,`npm run check`:类型检查、ESLint、**185 个测试**、生产构建全部通过)

- 状态机(T01–T13)、真实 HTTP 下的 Mock 全流程、日志 schema 拒绝内容字段(v1.1 的 75 个测试仍全部通过)。
- **遥测/价格**:价格计算(含 Unknown 不当 $0、Local $0、Mock 无费用)、SQLite 迁移与幂等、`observe` 包装在成功/失败/取消/超时/重试下都恰好写一行,且遥测自身出错不会改变原结果(M01–M05、M08)。
- **本地适配器**(针对**模拟的** whisper/Ollama/ffmpeg/say):请求形状、JSON schema 校验、ns→ms 换算与 `modelLoadMs`、`LOCAL_*` 错误映射、临时文件清理、绝不回退云端、非回环地址被拒绝、LAN 暴露检测。
- **/monitor 访问控制**(M09):全部受保护路由匿名 401、登录限流、伪造 `X-Forwarded-For` 无法绕过、跨源写请求 403、Cookie 属性、`MONITOR_LOCAL_ONLY`、无默认密码。
- **监控数据面**(M01/M02/M04/M06/M07/M10):Cloud 与 Local 任务经同一包装、两个并发会话无重复行、过滤/排序/分页、注入安全、数据库+CSV+全部 JSON 中无任何内容哨兵字符串、导出与带确认的清空。

### 已在真机/真实引擎上验证的部分

- **Mac 本地引擎真实运行**:whisper.cpp(small 与 large-v3-turbo-q5_0)、Ollama(`qwen3:8b`/`qwen3:14b`)、macOS `say`(Tingting/Alva)在这台 M4 / 32 GB 上用**合成语音**跑通完整链路(`local:smoke`、`local:e2e`),并通过真实 HTTP 写入监控库,得到 Local $0、冷启动 ≈8.2 s 与推理耗时分离等数据。
- **Cloud**:你之前已经在 iPhone 上确认 Cloud 流程可用;通过新遥测记录 Cloud 任务用 HTTP 脚本验证过(2 个任务已知费用约 $0.0007,TTS 为 Unknown),**但不是在 iPhone 上端到端重测**。
- 浏览器(Chromium)里手动检查过 `/monitor` 的登录、各标签页、图表与导出。

### ⚠️ 未验证(不要把它们当作已通过)

- **没有用成人真实说话完成 Local 的 iPhone 端到端测试**(L02/L03、完整 Local iPhone 流程)。目前只用过 `say` 合成语音,所以**不能宣称本地端到端已测试成功**。
- Whisper 对 iPhone 真实 `audio/mp4`(AAC)录音的识别准确率;iPhone Safari 是否能播放 `say` 生成的 WAV。
- 真正断开互联网的运行(L07 只在逻辑层验证:所有本地请求都只访问 127.0.0.1)。
- 真实儿童语音:**从未使用**,也不应使用。
- 价格表未联网核对;预算与成本仅供参考。
- 提示音使用浏览器 `speechSynthesis`,各设备差异未验证。

## 8. 已知限制

- 澄清计数在问题被**选定展示**时增加(TTS 失败时文字仍展示),而不是等音频播放完。
- 静音/停顿不会自动结束一段,只有手动停止或 30 秒超时。
- 录音保存在内存里;刷新页面会丢失当前任务(这是有意的,V1 不做持久化)。
- 翻译器的 `/api/asr|interpret|translate|tts` 在局域网内无认证(后端只监听 `127.0.0.1`,但 Vite 会把 `/api` 代理出去);只有 `/monitor` 及导出/清空类路由需要管理员登录。仅在可信网络使用,不要公开暴露。
- 本地模式的翻译质量取决于 8B 级模型,尤其是瑞典语与"是否追问"的判断,需要用成人真实语音继续评估。
- `npm audit` 报告的 vitest/tinypool 漏洞只影响开发测试工具链,不进入运行时;`npm audit fix --force` 会把 vitest 降到旧版本,所以没有执行。
- 生产部署(HTTPS、鉴权、限流)不在 V1 范围内。
