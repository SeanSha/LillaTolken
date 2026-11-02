# `apps/web/src/vocabulary/image.ts`

源码：[image.ts](../../../../../apps/web/src/vocabulary/image.ts)

检查选中的图片，并做出一张小缩略图。不是图片、太大，就拒绝。识别请求发出去的是处理过的字节，不是原样把任意文件塞给服务器。

例子：选了一张 HEIC 或 JPEG 的杯子。这里产出可以上传的图像和格子上用的小图。选了一个文本文件，这一步就停住。
