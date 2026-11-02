# `apps/server/src/config.ts`

源码：[config.ts](../../../../apps/server/src/config.ts)

把环境变量收成一个对象。其余代码不直接读 `process.env`。

默认值包括：监听 `127.0.0.1`，识别模型 `gpt-transcribe`，对话和识图 `gpt-6-luna`，朗读 `gpt-realtime-2.1-mini`，声音 `alloy`。`PROMPT_MEMORY` 默认开。

例子：`.env` 里写了 `OLLAMA_MODEL=qwen3:14b`。`loadLocalConfig` 把这个名字交给本地实现。不改状态机。

相对路径的数据库会落到 `apps/server/data/`。`:memory:` 保持内存库，测试用。
