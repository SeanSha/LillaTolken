# `apps/server/src/providers/local/probe.ts`

源码：[probe.ts](../../../../../../apps/server/src/providers/local/probe.ts)

问本机引擎是否在听：whisper 的健康检查、Ollama 的标签列表、`say` 是否存在。结果缓存大约两秒，避免每个请求都探一遍。

`GET /api/health` 会触发一次刷新，所以齿轮面板能看到 local 刚刚变成可用。

例子：先打开页面，再运行 `npm run local:start`。过一两秒再看健康状态，whisper 从不可用变成可用。中间不会改走 cloud。
