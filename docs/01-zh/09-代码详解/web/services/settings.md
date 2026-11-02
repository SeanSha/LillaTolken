# `apps/web/src/services/settings.ts`

源码：[settings.ts](../../../../../apps/web/src/services/settings.ts)

这台浏览器里记住的成人选项。不进状态机的任务。

- `micMode`：默认 `auto`。mock 用剧本麦克风，其他预设用真麦克风。
- `mockScenarioId`：默认 `T01`。
- `scenarioId`：成人自己写的测试标签，不能写孩子的原话。
- `cloudAcknowledged`：是否确认过只用成人或合成语音。

例子：在齿轮里把场景改成 T04。`settings.set` 通知界面刷新。下一次新任务，`runtime.ts` 的剧本从「他拿走了我的那个。」开始。

界面用 `useSettings()` 订阅。改一处，齿轮和录音机看到的是同一份。
