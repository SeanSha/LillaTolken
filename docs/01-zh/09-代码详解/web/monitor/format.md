# `apps/web/src/monitor/format.ts`

源码：[format.ts](../../../../../apps/web/src/monitor/format.ts)

把毫秒、美元和百分比显示成短字符串。算不出的费用显示成 Unknown，不显示成 0。

例子：耗时 2600 毫秒显示成秒。费用 `null` 显示 Unknown。本地的 0 美元仍显示 0，因为那是「没有云端账单」，不是缺失。
