# `apps/server/src/vocabulary/identify.ts`

源码：[identify.ts](../../../../../apps/server/src/vocabulary/identify.ts)

云端识图。用 Responses API，`store: false`，照片不留在厂商的存储开关上。超时至少 45 秒，不会被更短的普通 `OPENAI_TIMEOUT_MS` 截断。

输出要符合词卡 schema：一个物体、多个、不确定、人或没有。本地识图在 `providers/local/vision.ts`，实现同一接口。

例子：cloud 预设拍苹果。这里返回候选人。浏览器再按 `flow.ts` 决定是草稿还是拒绝。密钥仍只在服务器。
