# `apps/web/src/ui/App.tsx`

源码：[App.tsx](../../../../../apps/web/src/ui/App.tsx)

这是儿童界面的总壳。它启动状态机，决定画哪一屏，也负责从首页走进词卡。

每一段里的「线索」是 `App.tsx` 里能直接搜索的名字或判断，用来对上位置。中文仍是这一步在做什么。

## 启动状态机

`snap` 是状态机现在的快照。`send` 把按钮事件送回去。`screenOf` 把快照变成屏幕名。

`presetAtStart` 来自地址栏的 `?preset=`，否则用这台设备上次记住的预设。网址里是 `cloud`、大人还没确认过时，齿轮直接打开。

```text
启动时 {
  线索：startingPreset
  预设 = 地址栏里的预设，没有就用这台设备上次记住的
  线索：useActor(dialogueMachine)
  启动状态机，把这个预设交进去
  线索：screenOf(snap)
  屏幕名 = 把状态机现在的状态翻译成首页、录音、确认这类名字
  if (判定地址栏要 cloud，并且大人还没确认过) {
    线索：requested === 'cloud' && !cloudAcknowledged
    直接打开齿轮
  }
}
```

## `feature`：词卡是另一条路

`feature` 是 `null`、`photo` 或 `library`。

例子：首页点「拍照识字」。相机选中文件后 `setFeature('photo')`。下面改画 `VocabularyShell`。状态机停在空闲。

左上角返回把 `feature` 设回 `null`，对话首页又出现。

```text
线索：feature ，一开始是 null

点词卡里的返回 {
  线索：setOpeningFile(null) ；setFeature(null)
  清掉刚选的照片
  词卡开关关掉
}

首页相机选中一张图 {
  if (判定没有选到文件) {
    线索：if (!file) return
    return
  }
  线索：setOpeningFile(file) ；setFeature('photo')
  记下这张照片，进入拍照
}
```

## 顶栏

任务进行中、并且这一轮还没送达时，左边是取消，右边可以换方向。齿轮打开 `DevPanel`，那是给成人的，不参与儿童流程。

```text
if (判定这一轮还在进行，并且还没把译文送出) {
  线索：showTaskControls
  左边按钮：告诉状态机取消
    线索：send({ type: 'CANCEL' })
  右边按钮：告诉状态机想换成另一个方向
    线索：SWITCH_REQUESTED ，otherDirection
}
齿轮：打开成人设置
  线索：setDevOpen(true)
```

## 选择屏幕

`feature` 为空时，按 `screen` 渲染对应的一屏。每个屏幕都收到 `snap` 和 `send`。它们不修改任务计数。`feature` 有值时，词卡盖在上面。

```text
if (判定是首页，并且没在看词卡) 画首页
  线索：screen === 'home' && !feature → HomeScreen
if (判定正在录音) 画录音屏
  线索：screen === 'recording' → RecordingScreen
if (判定在问继续还是说完) 画这一屏
  线索：screen === 'segmentDecision'
if (判定正在等识别、理解、翻译或语音) 画忙碌屏
  线索：screen === 'busy'
if (判定在问一个短问题) 画提问屏
  线索：screen === 'clarify' → QuestionScreen kind="clarify"
if (判定在等孩子点是或不是) 画确认屏
  线索：screen === 'confirm' → QuestionScreen kind="confirm"
if (判定译文已经准备好) 画结果屏
  线索：screen === 'result'
if (判定在问要不要换方向) 画换方向屏
  线索：screen === 'switch'
if (判定这一步失败了还能重试) 画错误屏
  线索：screen === 'error'
if (判定问到头或听空太多次) 画兜底屏
  线索：screen === 'fallback'
if (判定没听清，并且没在看词卡) 画再录一次
  线索：screen === 'asrEmpty' && !feature
if (判定词卡开关开着) 改画词卡，对话屏先让开
  线索：feature && VocabularyShell
```
