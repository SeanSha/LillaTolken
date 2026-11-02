# `apps/server/src/providers/local/common.ts`

源码：[common.ts](../../../../../../apps/server/src/providers/local/common.ts)

一次本地请求的临时目录。`withTempDir` 保证函数返回、抛错或取消时，目录都会删掉。

`unavailable` 用来做统一的 `LOCAL_*` 错误，避免每个文件各写一种含糊消息。

例子：ffmpeg 转码写了一个 wav。无论 whisper 成功还是超时，临时目录都会被清掉，不会留在磁盘上。
