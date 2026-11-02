# `apps/web/src/vocabulary/photo.ts`

源码：[photo.ts](../../../../../apps/web/src/vocabulary/photo.ts)

一次拍照在浏览器里的步骤：选文件、认、得到草稿、保存到本机库。它调用 `api.ts` 和 `library.ts`，自己不决定对话流程。

例子：同一张照片再保存一次。它先按图片哈希找已有卡片，找到就打开那一张，不新建。
