# `apps/web/src/services/eventLogger.ts`

源码：[eventLogger.ts](../../../../../apps/web/src/services/eventLogger.ts)

把状态机的阶段事件攒一小会儿，再 `POST /api/events`。

## `log`

先交给 `EvalEventSchema` 检查。合法才进队列。大约 400 毫秒后一次性发出去，最多一批 100 条。

例子：点了「是」。日志里有事件类型、任务号、追问次数。没有「我想去厕所」这几个字。如果调用方多塞一个 `transcript` 字段，schema 失败，这条被丢掉。

页面隐藏或关闭时 `flush`，尽量把已经发生的阶段送出去。发送失败不会改变对话下一步。
