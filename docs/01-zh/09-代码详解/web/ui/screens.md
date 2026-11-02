# `apps/web/src/ui/screens.tsx`

源码：[screens.tsx](../../../../../apps/web/src/ui/screens.tsx)

每一屏的按钮和短文案。流程判断不在这里。按钮只 `send` 一个事件。

例子仍用「我想去厕所。」

## `HomeScreen`

两个大按钮：

- 说中文：`send({ type: 'START_TASK', direction: 'ZH_TO_SV' })`
- 说瑞典语：方向换成 `SV_TO_ZH`

下面还有拍照和我的词卡。它们调用 `onPhotoCards` / `onMyCards`，由 `App.tsx` 去改 `feature`，不发给状态机。

## `RecordingScreen`

大停止按钮发送 `STOP_SEGMENT`。倒计时到 0 时由钩子发出 `SEGMENT_TIMEOUT`。短句还在播放时可以 `SKIP_PROMPT`。

## `SegmentDecisionScreen`

「继续」发送 `CONTINUE_SPEAKING`。「说完」发送 `FINISH_INPUT`。

## `BusyScreen`

没有主按钮。它用 `busyStage(snap)` 显示正在识别、理解、翻译，还是准备语音。

## `QuestionScreen`

`kind="clarify"` 时，大麦克风发送 `START_ANSWER`。

`kind="confirm"` 时，是发送 `CONFIRM_YES`，否发送 `CONFIRM_NO`。两套按钮长得接近，事件不同。确认「我想去厕所」点是，才会翻译。

## `ResultScreen`

播放按钮重播已经得到的音频。新一轮发送 `NEW_TURN`。再录一次会再发 `START_TASK`。

## `SwitchScreen`、`ErrorScreen`、`FallbackScreen`、`AsrEmptyScreen`

换方向：`SWITCH_YES` / `SWITCH_NO`。

出错：`RETRY` 或 `CANCEL`。

问满或听不清太多次：`RESTART` 或 `CANCEL`。

没听清：`RETRY`，回到录音。
