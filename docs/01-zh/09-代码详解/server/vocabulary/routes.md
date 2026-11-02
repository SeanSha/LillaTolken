# `apps/server/src/vocabulary/routes.ts`

源码：[routes.ts](../../../../../apps/server/src/vocabulary/routes.ts)

家庭词库的 HTTP：配对、列卡片、上传图片和音频、删除、取媒体文件。识别本身是 `app.ts` 上的 `/api/vocabulary/identify`，不把照片永久存进这次识别。

配对用家庭口令。口令不是监控密码。

例子：家长页点同步。本机卡片经这里写到 Mac 的库。另一台用同一口令来列卡片，能看到它。删除要打到具体的卡片编号。
