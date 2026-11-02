# `apps/server/src/providers/local/vision.ts`

源码：[vision.ts](../../../../../../apps/server/src/providers/local/vision.ts)

本机看图，只用于词卡。模型必须是视觉模型，默认 `qwen3-vl:8b`。纯文字的 qwen3 不能看图。

照片只在这一次请求里使用。失败不会改走 OpenAI。

例子：local 预设下拍杯子。这里把图发给 Ollama，返回中文、瑞典语和分类。Ollama 没开时，界面看到本地错误，云端请求数不变。
