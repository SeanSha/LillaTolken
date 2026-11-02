# `apps/web/src/ui/hooks.ts`

源码：[hooks.ts](../../../../../apps/web/src/ui/hooks.ts)

两个界面用的小工具：倒计时，以及播放。

## `useCountdown`

从状态机记下的 `segmentStartedAt` 算出这一段还剩几秒。上限是 `LIMITS.segmentSeconds`，也就是 30。

例子：录音开始于某一毫秒。10 秒后这个函数返回大约 20。到 0 时，录音屏发出 `SEGMENT_TIMEOUT`。它不会因为安静就提前归零。

## `usePlayback`

播放音频库里某一槽的声音。Safari 可能拦住自动播放，这时 `blocked` 为真，界面把手动播放按钮留出来。只有真正播完才调用 `onEnded`。中途被停掉不算播完，也就不会把任务记成已送达。
