# `packages/shared/src/evaluation.ts`

源码：[evaluation.ts](../../../../packages/shared/src/evaluation.ts)

规定评估事件可以有哪些字段。这是一张严格的表：时间、任务号、方向、事件名、耗时、次数、错误类别。没有录音、原文、译文、提示词这些栏。

## 谁用它

状态机想记「确认已经点了是」。`eventLogger.ts` 把字段交给 `EvalEventSchema`。多出来的 `transcript` 会被拒绝，这条事件不会入库。

例子：点了确认。事件类型是 `CONFIRMATION_YES`，带 `taskId` 和 `clarificationCount`。孩子说的那句中文不在这条记录里。
