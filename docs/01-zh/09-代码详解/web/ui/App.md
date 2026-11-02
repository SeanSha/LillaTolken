# `apps/web/src/ui/App.tsx`

源码：[App.tsx](../../../../../apps/web/src/ui/App.tsx)

这是儿童界面的总壳。它启动状态机，决定画哪一屏，也负责从首页走进词卡。名字写在中文句子里，方便对着 `App.tsx` 搜。

## 启动状态机

`snap` 是状态机现在的快照。`send` 把按钮事件送回去。`screenOf` 把快照变成屏幕名。

`presetAtStart` 来自地址栏的 `?preset=`，否则用这台设备上次记住的预设。网址里是 `cloud`、大人还没确认过时，齿轮直接打开。

```text
预设 presetAtStart = 地址栏里的预设，没有就用这台设备上次记住的 startingPreset
useActor(dialogueMachine) 启动状态机，把 presetAtStart 交进去，得到 snap 和 send
屏幕名 screen = screenOf(snap)，把状态翻译成首页、录音、确认
if (地址栏 requested === 'cloud'，并且还没有 cloudAcknowledged) {
  setDevOpen(true) 直接打开齿轮
}
```

## `feature`：词卡是另一条路

`feature` 是 `null`、`photo` 或 `library`。

例子：首页点「拍照识字」。相机选中文件后 `setFeature('photo')`。下面改画 `VocabularyShell`。状态机停在空闲。

左上角返回把 `feature` 设回 `null`，对话首页又出现。

```text
feature 一开始是 null，后来可以是 'photo' 或 'library'

点词卡返回 {
  setOpeningFile(null)
  setFeature(null) 回到对话首页
}

首页相机选中一张图 {
  if (!file) return
  setOpeningFile(file)
  setFeature('photo') 进入拍照
}
```

## 顶栏

任务进行中、并且这一轮还没送达时，左边是取消，右边可以换方向。齿轮打开 `DevPanel`，那是给成人的，不参与儿童流程。

```text
if (showTaskControls：这一轮还在进行，并且结果还没 delivered) {
  左边 send({ type: 'CANCEL' })
  右边 send({ type: 'SWITCH_REQUESTED', direction: otherDirection(...) })
}
齿轮 setDevOpen(true) 打开 DevPanel
```

## 选择屏幕

`feature` 为空时，按 `screen` 渲染对应的一屏。每个屏幕都收到 `snap` 和 `send`。它们不修改任务计数。`feature` 有值时，词卡盖在上面。

```text
if (screen === 'home' && !feature) 画 HomeScreen
if (screen === 'recording') 画 RecordingScreen
if (screen === 'segmentDecision') 画「继续说 / 说完了」
if (screen === 'busy') 画忙碌屏
if (screen === 'clarify') 画 QuestionScreen，kind 是 clarify
if (screen === 'confirm') 画 QuestionScreen，kind 是 confirm
if (screen === 'result') 画 ResultScreen
if (screen === 'switch') 画 SwitchScreen
if (screen === 'error') 画 ErrorScreen
if (screen === 'fallback') 画 FallbackScreen
if (screen === 'asrEmpty' && !feature) 画再录一次
if (feature) 画 VocabularyShell，对话屏先让开
```
