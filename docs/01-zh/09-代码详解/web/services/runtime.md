# `apps/web/src/services/runtime.ts`

源码：[runtime.ts](../../../../../apps/web/src/services/runtime.ts)

这是浏览器里的装配车间。它创建状态机，并把录音机、播放器、HTTP、日志交进去。`machine.ts` 只看见这些零件的名字。

## 先准备好的零件

- `audioStore`：这一轮的录音，只放内存。
- `player`：播放译文。
- `prompts`：播放「请说吧」这类短句。
- `mockScript`：mock 场景的剧本，默认从设置里的场景开始。
- `logger`：把阶段事件送去服务器。事件里没有原句。

## `providers`

按预设做一份 HTTP 接口，并记住。状态机说「用当前任务的 preset 做识别」时，这里返回 `apiClient` 做出来的那一组。

## `RecorderFacade`

决定这一段用哪一种麦克风。

例子：预设是 mock，麦克风模式是默认的 `auto`。`choose()` 返回 `ScriptedRecorder`。点停止就得到剧本，例如「我想去厕所。」

预设是 cloud 或 local 时，永远用 `MediaRecorderRecorder`，也就是真麦克风。

`prepare()` 会在短句快说完时提前打开真麦克风。mock 且不是真麦克风时，这个函数什么也不做。

## `dialogueMachine`

文件末尾调用 `createDialogueMachine({ ... })`。新任务开始时 `onTaskStarted` 记住预设，并把剧本倒回第一句。所以每次新任务，T01 都从「我想去厕所。」重新来。

## `reportAudibleStart`

译文或提问的声音真正开始响时调用。它用 `responseLatency` 算出从「可以听了」到「听见了」的毫秒数，交给日志。重播不会再记一次。
