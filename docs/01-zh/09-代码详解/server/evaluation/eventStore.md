# `apps/server/src/evaluation/eventStore.ts`

源码：[eventStore.ts](../../../../../apps/server/src/evaluation/eventStore.ts)

收下 `/api/events` 的事件，放进内存列表，并追加到 `events.ndjson`。`PERSIST_EVENTS=off` 时不写文件。文件已被 git 忽略。

写入前再过一次严格 schema。然后也可以折进 SQLite，供监控的任务页使用。

例子：状态机发来 `TASK_STARTED`。这里接受。若身体里多了 `translation` 字段，整批被拒绝，返回错误，不写入半行。
