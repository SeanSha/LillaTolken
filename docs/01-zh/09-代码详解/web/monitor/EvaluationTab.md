# `apps/web/src/monitor/EvaluationTab.tsx`

源码：[EvaluationTab.tsx](../../../../../apps/web/src/monitor/EvaluationTab.tsx)

成人给某个任务打分：意思 0/1/2、对方是否听懂、识别有没有问题、界面困难次数、一句不含身份的备注。

这些分不是模型自己打的。技术上播完了，也不等于人工觉得沟通成功。

例子：T01 播完瑞典语。成人把意思打成 2。这条标注挂在 `taskId` 上，仍然没有存下原句。
