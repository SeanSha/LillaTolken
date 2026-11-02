# `apps/server/src/providers/local/index.ts`

源码：[index.ts](../../../../../../apps/server/src/providers/local/index.ts)

把本机的 whisper、Ollama 和 `say` 包成同一份 `ProviderBundle`。没有云端后备。某一个引擎失败，这一次调用失败，预设不会偷偷变成 cloud。

`modelFor` 告诉监控每个阶段用的本地模型名。视觉识别是另一条，在 `vision.ts`，不走这个翻译包的 `transcribe`。

例子：请求头是 local，Ollama 没开。理解这一步返回 `LOCAL_*`。同一分钟里 cloud 的请求数不会因此加一。
