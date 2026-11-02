# `apps/web/src/dialogue/selectors.ts`

源码：[selectors.ts](../../../../../apps/web/src/dialogue/selectors.ts)

状态机内部的状态名很多。界面只画十一个屏幕。这个文件做翻译。

## `screenOf`

`App.tsx` 每一帧都调用它：`const screen = screenOf(snap)`。认不出专门屏幕时，落到 `busy`。

例子：状态是 `idle`，返回 `home`。状态在确认的提问，返回 `confirm`。正在等识别，前面的判断都对不上，返回 `busy`。

```text
线索：function screenOf
if (判定还在首页) return 首页
  线索：matches('idle') → 'home'
if (判定正在问要不要换方向) return 换方向
  线索：matches('confirmingSwitch') → 'switch'
if (判定正在录音) return 录音
  线索：matches({ task: 'recording' })
if (判定在问继续还是说完) return 这一屏
  线索：matches({ task: 'segmentDecision' })
if (判定短问题已经问出来了) return 提问
  线索：clarifying: 'asking' → 'clarify'
if (判定确认句已经问出来了) return 确认
  线索：confirming: 'asking' → 'confirm'
if (判定到了结果，并且语音已经准备好) return 结果
  线索：task: 'result' ，并且不是 result: 'synthesizing'
if (判定这一步失败了还能重试) return 错误
  线索：recoverableError → 'error'
if (判定问到头或听空太多次) return 兜底
  线索：fallback
if (判定没听清) return 再录一次
  线索：asrEmpty
前面都不成立 return 忙碌
  线索：return 'busy'
```

结果还在合成语音时，最后一个专门判断不成立，所以仍是 `busy`，字是「准备语音」。合成完才变成 `result`。

## `busyStage`

忙碌屏再分成四段，好让成人看见卡在哪。对不上前三个时当作 `tts`。

```text
线索：function busyStage
if (判定正在把声音变成文字) return 识别
  线索：transcribing → 'asr'
if (判定正在理解中文意思) return 理解
  线索：interpreting → 'interpret'
if (判定正在翻译) return 翻译
  线索：translating → 'translate'
return 准备语音
  线索：return 'tts'
```

`BUSY_LABEL` 是这四段旁边的短句，中文和瑞典语写在一起。
