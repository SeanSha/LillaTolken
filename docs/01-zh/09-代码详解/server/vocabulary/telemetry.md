# `apps/server/src/vocabulary/telemetry.ts`

源码：[telemetry.ts](../../../../../apps/server/src/vocabulary/telemetry.ts)

给一次识图写监控行：耗时和接口返回的 token。不写照片，不写认出来的词。

阶段名让费用页能把 Photo Vocabulary 和翻译分开显示。缓存的重播不再走这里，所以不会多一行。

例子：再识别一张旧卡片。请求页出现一行 IDENTIFY。卡片上的词只留在词库里。
