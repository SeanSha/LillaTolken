# `apps/web/src/vocabulary/library.ts`

源码：[library.ts](../../../../../apps/web/src/vocabulary/library.ts)

这台设备上的词卡库，放在 IndexedDB，库名 `kt-vocabulary`。清除 Safari 网站数据会删掉这一份。已经同步到 Mac 的家庭库不受影响。

例子：保存杯子卡片后刷新页面。`library` 仍能列出它。这和对话录音不同，录音刷新就没了。
