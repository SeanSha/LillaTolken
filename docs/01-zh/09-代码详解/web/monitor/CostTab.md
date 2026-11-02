# `apps/web/src/monitor/CostTab.tsx`

源码：[CostTab.tsx](../../../../../apps/web/src/monitor/CostTab.tsx)

单价说明、软预算、导出和清空。

Photo Vocabulary 和 Translation 是同一批请求的两面，页面把它们分开显示，不要再加一遍。预算只提醒，不阻止下一次翻译。

清空要再确认一次。导出是 CSV，里面同样没有原文。

例子：云端实时语音返回了 token。这一行可以算出美元。旧的非流式语音没返回用量时，这一行保持 Unknown。
