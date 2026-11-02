# `apps/server/src/providers/local/exec.ts`

源码：[exec.ts](../../../../../../apps/server/src/providers/local/exec.ts)

启动外部程序：ffmpeg、`say`、whisper。参数是数组，不拼进 shell，所以用户文本不能变成额外命令。

失败变成 `CommandError`，带退出码。调用方再把它映射成 `LOCAL_*`。超时或取消会停掉子进程。

例子：`say` 收到一句瑞典语。参数是声音名和输出文件，不是 `say ${文本}` 这种字符串拼接。
