# `apps/server/src/providers/mock/wav.ts`

源码：[wav.ts](../../../../../../apps/server/src/providers/mock/wav.ts)

做出一段很短的 WAV，给 mock 的朗读用。它不是瑞典语发音，只是让播放器有字节可播，从而把「播放结束才算送达」这条路径走通。

例子：T01 点了是。`/api/tts` 返回这段正弦波。手机上能听到一声短音，状态机能进入已送达。要听真正的瑞典语，需要 cloud 或 local。
