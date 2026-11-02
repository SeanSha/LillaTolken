# `apps/web/src/ui/App.tsx`

源码：[App.tsx](../../../../../apps/web/src/ui/App.tsx)

这是儿童界面的总壳。它启动状态机，决定画哪一屏，也负责从首页走进词卡。

## 启动状态机

```tsx
const [snap, send] = useActor(dialogueMachine, { input: { preset: presetAtStart } });
const screen = screenOf(snap);
```

`snap` 是状态机现在的快照。`send` 把按钮事件送回去。`screenOf` 把快照变成屏幕名。

`presetAtStart` 来自地址栏的 `?preset=`，否则用这台设备上次记住的预设。

## `feature`：词卡是另一条路

`feature` 是 `null`、`photo` 或 `library`。

例子：首页点「拍照识字」。`setFeature('photo')`。下面不再画对话屏幕，而画 `VocabularyShell`。状态机停在空闲。

左上角返回把 `feature` 设回 `null`，对话首页又出现。

## 顶栏

任务进行中，左边是取消，发出 `CANCEL`。右边可以换方向，发出 `SWITCH_REQUESTED`。齿轮打开 `DevPanel`，那是给成人的，不参与儿童流程。

## 选择屏幕

`feature` 为空时，按 `screen` 渲染 `HomeScreen`、`RecordingScreen`、`QuestionScreen` 等。每个屏幕都收到 `send`。它们不修改任务计数。
