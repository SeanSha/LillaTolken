# `apps/server/src/providers/registry.ts`

源码：[registry.ts](../../../../../apps/server/src/providers/registry.ts)

启动时做出三份实现，放进一张表。`app.ts` 用预设名字来取。

```ts
mock  → 假识别、假理解、假翻译、一段短音频。始终可用。
cloud → OpenAI。没有 OPENAI_API_KEY 就标成不可用。
local → whisper + Ollama + say。可用状态随本机引擎变化。
```

例子：请求头是 `mock`。`registry.mock.bundle.asr.transcribe` 被调用。换成 `cloud` 时，状态机和路由都不变，取到的是 `registry.cloud.bundle`。

`local.refresh` 会再探一次本机引擎。`index.ts` 在监听端口之前调用它，所以第一个请求就知道 local 能不能用。

每一份还带 `modelFor(stage)`，告诉监控这一步用的模型名字。这里没有密钥。
