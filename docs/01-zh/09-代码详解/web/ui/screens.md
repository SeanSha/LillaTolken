# `apps/web/src/ui/screens.tsx`

源码：[screens.tsx](../../../../../apps/web/src/ui/screens.tsx)

每一屏的按钮和短文案。流程判断不在这里。按钮只 `send` 一个事件。

例子仍用「我想去厕所。」

## `HomeScreen`

两个大按钮分别开两个方向。点下去之前先解锁播放，不然 iPhone 上后面的声音可能出不来。拍照和我的词卡调用 `onPhotoCards` / `onMyCards`，由 `App.tsx` 去改 `feature`，不发给状态机。

例子：点「中文 → Svenska」，发出的方向是 `ZH_TO_SV`。

```tsx
const start = (direction) => {
  player.unlock();
  send({ type: 'START_TASK', direction });
};

<BigButton onClick={() => start('ZH_TO_SV')} />
<BigButton onClick={() => start('SV_TO_ZH')} />
```

## `RecordingScreen`

大停止按钮发送 `STOP_SEGMENT`。倒计时到 0 时由钩子发出 `SEGMENT_TIMEOUT`。短句还在播放时可以 `SKIP_PROMPT`。

```tsx
onClick={() => send({ type: 'STOP_SEGMENT' })}
onClick={() => send({ type: 'SKIP_PROMPT' })}
```

## `SegmentDecisionScreen`

「继续」再录一段。「说完」把已经录下的各段送去识别。

```tsx
onClick={() => send({ type: 'CONTINUE_SPEAKING' })}
onClick={() => send({ type: 'FINISH_INPUT' })}
```

## `BusyScreen`

没有主按钮。它用 `busyStage(snap)` 显示正在识别、理解、翻译，还是准备语音。

## `QuestionScreen`

`kind` 决定这一屏的按钮。确认「我想去厕所」点是，才会翻译。

```tsx
if (kind === 'clarify') {
  onClick={() => send({ type: 'START_ANSWER' })}
}
if (kind === 'confirm') {
  onClick={() => send({ type: 'CONFIRM_YES' })}
  onClick={() => send({ type: 'CONFIRM_NO' })}
}
```

## `ResultScreen`

声音放完，发出送达。播放失败时，大人可以接受只看文字。再来一轮或回首页是另外两个事件。

```tsx
if (pending) send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
onClick={() => send({ type: 'DELIVERY_FINISHED', mode: 'text_only' })}
onClick={() => send({ type: 'START_TASK', direction: task.direction })}
onClick={() => send({ type: 'NEW_TURN' })}
```

## `SwitchScreen`、`ErrorScreen`、`FallbackScreen`、`AsrEmptyScreen`

```tsx
onClick={() => send({ type: 'SWITCH_YES' })}
onClick={() => send({ type: 'SWITCH_NO' })}

onClick={() => send({ type: 'RETRY' })}
onClick={() => send({ type: 'CANCEL' })}

onClick={() => send({ type: 'RESTART' })}
onClick={() => send({ type: 'CANCEL' })}

onClick={() => send({ type: 'RETRY' })}
```
