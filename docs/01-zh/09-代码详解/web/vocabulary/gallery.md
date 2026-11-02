# `apps/web/src/vocabulary/gallery.ts`

源码：[gallery.ts](../../../../../apps/web/src/vocabulary/gallery.ts)

词卡墙的筛选、排序和分页。一页 `GALLERY_PAGE` 是 24 张。

可以按分类、中文或瑞典语搜索、日期范围，并按新旧或字母排序。

例子：家长页搜索「苹果」，`filterSummaries` 只留下中文或瑞典语里含这个词的卡片。它不分组，只是过滤后排序再分页。
