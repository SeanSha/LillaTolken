# `apps/server/src/telemetry/queries.ts`

源码：[queries.ts](../../../../../apps/server/src/telemetry/queries.ts)

监控页要的汇总、过滤、排序和分页。条件都在 SQL 参数里，不把用户输入拼进语句。

它按阶段算次数和延迟，把词卡识别和翻译分开统计，但它们来自同一批请求行。

例子：概览要近 7 天、只要 local。这里返回任务数、p50、p95。请求页要第 2 页时，这里带 `limit` 和 `offset`，不把全表发给浏览器。
