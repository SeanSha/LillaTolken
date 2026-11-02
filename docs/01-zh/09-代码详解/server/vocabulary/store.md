# `apps/server/src/vocabulary/store.ts`

源码：[store.ts](../../../../../apps/server/src/vocabulary/store.ts)

家庭词库的 SQLite 加一个媒体文件夹。数据库里是词、分类和文件路径。图片字节在 `vocabulary-media` 目录，不塞进数据库。

默认文件是 `apps/server/data/vocabulary.sqlite`，不要和监控库混用。

例子：同步一张杯子。表里有中文和瑞典语，照片是旁边的一个文件。删卡片时，记录和文件一起去掉。
