# `apps/server/src/telemetry/db.ts`

源码：[db.ts](../../../../../apps/server/src/telemetry/db.ts)

SQLite 里的监控表：会话、任务、片段、每次模型调用、评估事件、人工评分。默认文件是 `apps/server/data/telemetry.sqlite`，已被 git 忽略。

启动时做迁移。旧数据缺费用时留空，不改成 0。

例子：两个手机同时各走一轮。两行任务的 `taskId` 不同，不会并成一行。刷新监控页，这些行还在，因为它们不在浏览器内存里。
