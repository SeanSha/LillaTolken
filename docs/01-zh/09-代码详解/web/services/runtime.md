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

预设是 cloud 或 local 时，永远用 `MediaRecorderRecorder`，也就是真麦克风。mock 里如果成人把麦克风改成 `real`，仍用剧本交文本，但声音从真麦克风录，用来试权限。

`prepare()` 会在短句快说完时提前打开真麦克风。mock 且不是真麦克风时，这个函数什么也不做。

```text
function 选麦克风() {
  if (判定当前预设不是 mock) {
    return 真麦克风
  }
  if (判定成人把麦克风设成了真的) {
    return 用真麦克风录音，但交出去的文字仍是剧本
  }
  return 剧本麦克风
}

function 提前打开麦克风() {
  if (判定是 mock，并且没有要求真麦克风) {
    return 什么也不做
  }
  打开真麦克风，等短句说完就能录
}
```

## `dialogueMachine`

文件末尾调用 `createDialogueMachine`。新任务开始时记住预设，并把剧本倒回第一句。所以每次新任务，T01 都从「我想去厕所。」重新来。

```text
装配状态机 {
  交进去：请求、录音机、音频库、短句、停止播放、记日志
  新的一轮开始时 {
    记住这一轮的预设
    把剧本倒回第一句
  }
}
```

## `reportAudibleStart`

译文或提问的声音真正开始响时调用。它用 `responseLatency` 算出从「可以听了」到「听见了」的毫秒数，交给日志。重播不会再记一次。
