# `apps/web/src/audio/audioStore.ts`

源码：[audioStore.ts](../../../../../apps/web/src/audio/audioStore.ts)

只在内存里放音频。不写磁盘，不放进状态机快照，也不放进评估日志。

## 两块地方

`segments`：这一轮还没识别的各段，按 `taskId` 分开。

`playback`：两个槽。`prompt` 放「请说吧」这类短句，`result` 放译文语音。

例子：孩子说了两段才点「说完」。`addSegment` 被调用两次。识别开始后，状态机调用 `clearSegments`，这两段从内存消失。刷新页面，整个对象都没了，当前任务也就没了。这是有意的。
