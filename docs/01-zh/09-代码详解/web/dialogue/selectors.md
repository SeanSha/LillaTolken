# `apps/web/src/dialogue/selectors.ts`

源码：[selectors.ts](../../../../../apps/web/src/dialogue/selectors.ts)

状态机内部的状态名很多。界面只画十一个屏幕。这个文件做翻译。

## `screenOf`

例子：

- 状态是 `idle` → 屏幕 `home`。
- 状态在 `task.recording` → 屏幕 `recording`。
- 状态在确认的提问 → 屏幕 `confirm`。
- 状态在澄清的提问 → 屏幕 `clarify`。
- 认不出来、正在等模型 → 屏幕 `busy`。

`App.tsx` 每一帧都调用它：`const screen = screenOf(snap)`。

## `busyStage`

忙碌屏再分成四段，好让成人看见卡在哪：

- `transcribing` → `asr`
- `interpreting` → `interpret`
- `translating` → `translate`
- 其余忙碌，多半是在准备语音 → `tts`

`BUSY_LABEL` 是这四段旁边的短句，中文和瑞典语写在一起。
