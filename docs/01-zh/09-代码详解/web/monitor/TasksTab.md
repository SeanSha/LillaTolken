# `apps/web/src/monitor/TasksTab.tsx`

源码：[TasksTab.tsx](../../../../../apps/web/src/monitor/TasksTab.tsx)

每一个翻译任务一行：方向、冻结的预设、录了几段、追问次数、是否送达、关联费用。

点进去能看到这个 `taskId` 下的各次请求。费用是这些请求加总，包含重试，不是假设每个任务只调用一次模型。

例子：含糊句追问了一次又确认。任务行上的理解次数大于 1，请求列表里能对上。
