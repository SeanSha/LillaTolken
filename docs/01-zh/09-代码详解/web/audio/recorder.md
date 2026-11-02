# `apps/web/src/audio/recorder.ts`

源码：[recorder.ts](../../../../../apps/web/src/audio/recorder.ts)

两种录音机，都实现状态机要的 `start` / `stop` / `cancel`。

## 真麦克风 `MediaRecorderRecorder`

先看浏览器支持哪种格式，顺序是 mp4、webm、ogg。iPhone 通常是 `audio/mp4`。采样目标是 16 kHz 单声道，方便后面交给 whisper。

`inspectMicEnvironment` 告诉齿轮面板：是不是安全网页、有没有 `getUserMedia`。不是 HTTPS 时，手机上的麦克风不会开。

一段音频停下来后，变成状态机能存进 `audioStore` 的字节。

## 剧本麦克风 `ScriptedRecorder`

`stop()` 不看声波，按 `MockScript` 交出下一句，并做成很短的音频，让后面的流程仍有一段「录音」。

例子：mock、T01。点停止。`stop()` 的结果里，剧本文本是「我想去厕所。」真麦克风那条路径在 cloud 和 local 里使用。
