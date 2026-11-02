# `apps/server/src/providers/local/tts.ts`

源码：[tts.ts](../../../../../../apps/server/src/providers/local/tts.ts)

用 macOS `say` 朗读。声音在运行时用 `say -v '?'` 查找，不把一个可能不存在的名字写死。中文优先 `zh_CN` 和 Tingting，瑞典语优先 `sv_SE` 和 Alva。

命令用参数数组启动，不经过 shell。文本先写入临时文件，避免被当成命令。输出转成 16 位 WAV，iPhone 能播。

没有云端后备。声音缺失就是 `LOCAL_TTS_UNAVAILABLE`。`local:doctor` 会查看有没有 Piper，但真正朗读的是这一份 `say`。

例子：确认后的瑞典语译文。选中 Alva，生成 wav，经 `/api/tts` 回到手机。
