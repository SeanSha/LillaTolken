# `apps/server/src/vocabulary/image.ts`

源码：[image.ts](../../../../../apps/server/src/vocabulary/image.ts)

服务器再检查一次上传的身体是不是图片，以及有没有超过大小限制。浏览器里的检查可以被绕过，所以这里还要做。

不是图片就拒绝。识别路由不会把任意字节送给模型。

例子：有人直接往识别接口 POST 一段文本。这里返回错误，不会产生一张卡片。
