# `apps/server/src/telemetry/modelConfig.ts`

源码：[modelConfig.ts](../../../../../apps/server/src/telemetry/modelConfig.ts)

记下这一轮实际用的模型名字，挂到测试场次上。这样事后能说「这场用的是哪一个模型」，而不必把名字写进每一句译文。

例子：cloud 的对话模型是 `gpt-6-luna`，朗读是 `gpt-realtime-2.1-mini`。一场测试开始后，这些名字进模型配置行。换了 `.env` 再开一场，是另一行配置。
