# `apps/web/src/vocabulary/api.ts`

源码：[api.ts](../../../../../apps/web/src/vocabulary/api.ts)

浏览器向 `POST /api/vocabulary/identify` 发照片。请求带当前预设。返回的 JSON 交给 `flow.ts`。

例子：预设是 local。照片只在这一次请求里到本机视觉模型。失败不会改成 cloud。预设是 cloud 时，仍由服务器拿密钥去调用，浏览器看不到密钥。
