# `apps/server/src/providers/local/doctor.ts`

源码：[doctor.ts](../../../../../../apps/server/src/providers/local/doctor.ts)

`npm run local:doctor` 的报告。它看芯片、内存、磁盘、有没有 ollama、ffmpeg、whisper、`say`，以及已安装的模型和声音。

缺什么就打印下一步，例如去 `ollama pull`。它也检查引擎是不是听在局域网地址上，是的话警告。

报告里没有密钥，也没有录音。Piper 只作为可选项出现在工具列表里。当前朗读路径仍是 `say`。

例子：瑞典语声音没装。医生会告诉你到系统设置里下载，而不是假装 local 已经能读瑞典语。
