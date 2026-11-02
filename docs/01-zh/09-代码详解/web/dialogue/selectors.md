# `apps/web/src/dialogue/selectors.ts`

源码：[selectors.ts](../../../../../apps/web/src/dialogue/selectors.ts)

状态机内部的状态名很多。界面只画十一个屏幕。这个文件做翻译。

## `screenOf`

`App.tsx` 每一帧都调用它：`const screen = screenOf(snap)`。认不出专门屏幕时，落到 `busy`。

例子：状态是 `idle`，返回 `home`。状态在确认的提问，返回 `confirm`。正在等识别，前面的判断都对不上，返回 `busy`。

```ts
function screenOf(s) {
  if (s.matches('idle')) return 'home';
  if (s.matches('confirmingSwitch')) return 'switch';
  if (s.matches({ task: 'recording' })) return 'recording';
  if (s.matches({ task: 'segmentDecision' })) return 'segmentDecision';
  if (s.matches({ task: { clarifying: 'asking' } })) return 'clarify';
  if (s.matches({ task: { confirming: 'asking' } })) return 'confirm';
  if (s.matches({ task: 'result' }) && !s.matches({ task: { result: 'synthesizing' } })) return 'result';
  if (s.matches({ task: 'recoverableError' })) return 'error';
  if (s.matches({ task: 'fallback' })) return 'fallback';
  if (s.matches({ task: 'asrEmpty' })) return 'asrEmpty';
  return 'busy';
}
```

结果还在合成语音时，最后一个专门判断不成立，所以仍是 `busy`，字是「准备语音」。合成完才变成 `result`。

## `busyStage`

忙碌屏再分成四段，好让成人看见卡在哪。对不上前三个时当作 `tts`。

```ts
function busyStage(s) {
  if (s.matches({ task: 'transcribing' })) return 'asr';
  if (s.matches({ task: 'interpreting' })) return 'interpret';
  if (s.matches({ task: 'translating' })) return 'translate';
  return 'tts';
}
```

`BUSY_LABEL` 是这四段旁边的短句，中文和瑞典语写在一起。
