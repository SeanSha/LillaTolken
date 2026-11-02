# `apps/server/scripts/`

这些文件不在孩子打开的网页里。它们是你在终端里跑的检查。命令写在仓库根目录的 `package.json`。它们用编出来的句子，不用真实儿童录音。

## `local-doctor.ts`

命令：`npm run local:doctor`。

调用 `runDoctor`，打印这台 Mac 能不能跑 local：芯片、内存、有没有 whisper、Ollama、ffmpeg、`say`，以及声音和模型。加 `--json` 打出机器可读的报告。没准备好时退出码是 1。

例子：瑞典语声音没装。终端告诉你去系统设置下载。它不会替你下载，也不会改去 cloud。

## `local-start.ts`

命令：`npm run local:start`。

先拒绝非本机地址。Ollama 如果已经在听，就发一次空的预热，让模型先载入内存，这次请求里没有句子。whisper 没在听，就在 `127.0.0.1` 上把它拉起来，并把 pid 写到 `data/whisper-server.pid`。Ctrl-C 会停掉它自己启动的进程。它不安装软件，也不下载模型。

例子：医生说 whisper 没启动。跑这个命令后，再打开网页，健康检查里的 local 识别才会变成可用。

## `local-smoke.ts`

命令：`npm run local:smoke`。

用 Mac 自己的 `say` 造一段假语音，走 local 的识别、理解、翻译、朗读，看管道通不通、要多久。输出里会说明：这不是真人对着 iPhone 说话的验收。

例子：句子是人造的中文。三台引擎都在时，终端打印每一步毫秒数。Ollama 没开就在这一步失败，不会悄悄改用 OpenAI。

## `local-eval.ts`

命令：`npm run local:eval`。

拿 `scenarios.ts` 里大约 20 条人造句子，默认只打 local。要打 cloud，必须同时有 `--allow-cloud` 和密钥，避免手滑花钱。它比较「该不该追问、该不该直接给意思」，不保存音频。

例子：`Z01-clear` 是「我想去厕所。」，期望 `PROPOSE`。`Z07-ambig` 是「他拿走了我的那个。」，期望 `ASK`，假想回答是「我的水壶。」

## `scenarios.ts`

给上面那次评估用的句子清单。5 句清楚的中文、10 句破碎或含糊的中文、5 句瑞典语。注释写明这不是真实儿童说话。

## `eval-narratives.ts` 和 `narrativeScenarios.ts`

命令：`npm run eval:narratives`。

再检查一轮「叙述类」理解：什么时候该提出意思，什么时候该追问，次数用完以后该怎样。结果只打印在终端，不写结果文件，也不覆盖以前的试验记录。cloud 同样要 `--allow-cloud`。句子在 `narrativeScenarios.ts`，并带一个 `assessNarrative` 用来对照期望。

## `local-e2e-http.ts`

命令：`npm run local:e2e`。

这时 Node 已经在跑。脚本像手机一样发 HTTP：带头 `X-Provider-Preset`、任务编号、请求编号，走识别、理解、翻译、朗读。默认预设是 local 或 mock。写明拒绝 cloud。因为走的是真路由，监控里会出现这些请求的耗时行，仍然没有原文。

例子：服务开着，跑一轮。打开 `/monitor`，请求页能看到刚才那次，内容列里没有「我想去厕所」。

## `check-cloud.ts`

命令：`npm run check:cloud`。

没有密钥就退出码 2，并说明什么都没发给 OpenAI。有密钥时用一句人造中文「我想去厕所。」走：中文朗读、中文识别、理解、译成瑞典语、瑞典语朗读、再识别、再译回中文。全过是退出码 0，失败是 1。这是花钱的检查，不要拿孩子的话去跑。
