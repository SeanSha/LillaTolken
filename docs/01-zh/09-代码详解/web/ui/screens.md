# `apps/web/src/ui/screens.tsx`

源码：[screens.tsx](../../../../../apps/web/src/ui/screens.tsx)

每一屏的按钮和短文案。流程判断不在这里。按钮只 `send` 一个事件。

例子仍用「我想去厕所。」

## `HomeScreen`

两个大按钮分别开两个方向。点下去之前先解锁播放，不然 iPhone 上后面的声音可能出不来。拍照和我的词卡调用 `onPhotoCards` / `onMyCards`，由 `App.tsx` 去改 `feature`，不发给状态机。

例子：点「中文 → Svenska」，发出的方向是 `ZH_TO_SV`。

```text
线索：HomeScreen 里的 start
function 开始一轮(方向) {
  线索：player.unlock()
  先让手机允许之后播放声音
  线索：send({ type: 'START_TASK', direction })
  告诉状态机：开始任务，方向是这个
}

点「中文 → Svenska」→ 开始一轮(中文到瑞典语)
  线索：direction: 'ZH_TO_SV'
点「Svenska → 中文」→ 开始一轮(瑞典语到中文)
  线索：direction: 'SV_TO_ZH'
```

## `RecordingScreen`

大停止按钮发送 `STOP_SEGMENT`。倒计时到 0 时由钩子发出 `SEGMENT_TIMEOUT`。短句还在播放时可以 `SKIP_PROMPT`。

```text
点停止 → 告诉状态机：这一段说完了
  线索：STOP_SEGMENT
点跳过短句 → 告诉状态机：不用再听「请说吧」
  线索：SKIP_PROMPT
```

## `SegmentDecisionScreen`

「继续」再录一段。「说完」把已经录下的各段送去识别。

```text
点继续 → 告诉状态机：再录一段，仍是这一轮
  线索：CONTINUE_SPEAKING
点说完 → 告诉状态机：把已经录下的各段送去识别
  线索：FINISH_INPUT
```

## `BusyScreen`

没有主按钮。它用 `busyStage(snap)` 显示正在识别、理解、翻译，还是准备语音。

## `QuestionScreen`

`kind` 决定这一屏的按钮。确认「我想去厕所」点是，才会翻译。

```text
if (判定这一屏是在追问) {
  线索：kind === 'clarify'
  点麦克风 → 告诉状态机：开始回答
    线索：START_ANSWER
}
if (判定这一屏是在确认) {
  线索：kind === 'confirm'
  点是 → 告诉状态机：意思对
    线索：CONFIRM_YES
  点不是 → 告诉状态机：意思不对
    线索：CONFIRM_NO
}
```

## `ResultScreen`

声音放完，发出送达。播放失败时，大人可以接受只看文字。再来一轮或回首页是另外两个事件。

```text
if (判定声音正在等着播完) {
  线索：DELIVERY_FINISHED ，mode: 'audio'
  播完 → 告诉状态机：已经用声音送达
}
点只看文字 → 告诉状态机：大人接受没有声音
  线索：mode: 'text_only'
点再来一次 → 用同一个方向再开一轮
  线索：START_TASK
点回首页 → 告诉状态机：这一轮结束
  线索：NEW_TURN
```

## `SwitchScreen`、`ErrorScreen`、`FallbackScreen`、`AsrEmptyScreen`

```text
换方向屏：点换 → 换成另一个方向；点留下 → 回到刚才那一步
  线索：SwitchScreen ，SWITCH_YES / SWITCH_NO
错误屏：点重试 → 再做失败的那一步；点取消 → 回首页
  线索：ErrorScreen ，RETRY / CANCEL
兜底屏：点重新开始 → 同一方向再来一轮；点取消 → 回首页
  线索：FallbackScreen ，RESTART / CANCEL
没听清：点再录 → 回到录音
  线索：AsrEmptyScreen ，RETRY
```
