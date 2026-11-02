# `apps/web/src/monitor/RequestsTab.tsx`

源码：[RequestsTab.tsx](../../../../../apps/web/src/monitor/RequestsTab.tsx)

每一次模型调用一行。列里有时间、预设、阶段、耗时、状态、token 和费用依据。

`costCell` 按依据显示金额或 Unknown。点一行看 `RequestDetail`。

例子：T01 走完 mock。这里至少有识别、理解、翻译、朗读四行，同属一个 `taskId`。费用是不适用，不是一笔云端账单。
