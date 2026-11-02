# `apps/server/src/providers/local/ollama.ts`

源码：[ollama.ts](../../../../../../apps/server/src/providers/local/ollama.ts)

调用本机 `POST /api/chat`。`stream` 关闭。理解要求 JSON，并用和云端同一套 schema 检查。

Ollama 的时间是纳秒。这里除以 1,000,000 变成毫秒。模型加载时间 `load_duration` 单独变成 `modelLoadMs`，不混进推理时间。

例子：第一次请求 qwen3:8b，加载大约数秒，记在 `modelLoadMs`。下一句如果模型还热着，这一项会小很多。token 数会记下，但本地没有云端费用。
