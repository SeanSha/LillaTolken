# `apps/server/src/media/transcode.ts`

源码：[transcode.ts](../../../../../apps/server/src/media/transcode.ts)

用 ffmpeg 把浏览器音频转成识别要用的 WAV。iPhone 的 `audio/mp4` 走这里。转换在本机完成，不把原文件送到别的转码服务。

失败时调用方得到本地错误，临时文件由 `common.ts` 清掉。

例子：一段 5 秒的 AAC。输出是 16 kHz 单声道。whisper 只看见这个 wav。
