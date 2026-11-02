# `apps/server/src/providers/local/config.ts`

源码：[config.ts](../../../../../../apps/server/src/providers/local/config.ts)

本机引擎的地址和模型名。whisper 默认 `127.0.0.1:8080`，Ollama 默认 `127.0.0.1:11434`。不是回环地址会被拒绝，避免把引擎暴露到局域网。

视觉模型默认 `qwen3-vl:8b`，超时默认 120 秒。文字模型默认 `qwen3:8b`。

例子：有人把 `OLLAMA_HOST` 设成 `0.0.0.0`。这里拒绝用这个地址做推理。`local:doctor` 还会另外警告局域网暴露。
