# `apps/server/src/providers/local/whisper.ts`

源码：[whisper.ts](../../../../../../apps/server/src/providers/local/whisper.ts)

调用只听在本机的 whisper.cpp。iPhone 传来的往往是 AAC。`convertToWav` 用 ffmpeg 转成 16 kHz、单声道、16 位 PCM，再交给识别。

按语言传 `zh` 或 `sv`。识别内部不翻译。转码耗时单独记成 `conversionMs`。

例子：瑞典语到中文。语言是 `sv`。返回的是听到的瑞典语原文。译成中文是后面的 Ollama，不是 whisper。

临时文件在请求结束时删除，包括失败和取消。
