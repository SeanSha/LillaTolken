# `apps/web/src/vocabulary/hash.ts`

源码：[hash.ts](../../../../../apps/web/src/vocabulary/hash.ts)

对照片字节算 SHA-256。同一张图再保存时，用这个值找到旧卡片。

例子：把刚才那张杯子再选一次。哈希相同，`photo.ts` 打开已有卡片。换一张苹果，哈希不同，才是新卡。
