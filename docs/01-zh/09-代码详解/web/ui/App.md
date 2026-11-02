# `apps/web/src/ui/App.tsx`

源码：[App.tsx](../../../../../apps/web/src/ui/App.tsx)

这是儿童界面的总壳。它启动状态机，决定画哪一屏，也负责从首页走进词卡。

## 启动状态机

`snap` 是状态机现在的快照。`send` 把按钮事件送回去。`screenOf` 把快照变成屏幕名。

`presetAtStart` 来自地址栏的 `?preset=`，否则用这台设备上次记住的预设。网址里是 `cloud`、大人还没确认过时，齿轮直接打开。

```tsx
const [presetAtStart] = useState(startingPreset);
const [snap, send] = useActor(dialogueMachine, { input: { preset: presetAtStart } });
const [devOpen, setDevOpen] = useState(() => {
  const requested = new URLSearchParams(window.location.search).get('preset');
  return requested === 'cloud' && !settings.get().cloudAcknowledged;
});
const screen = screenOf(snap);
```

## `feature`：词卡是另一条路

`feature` 是 `null`、`photo` 或 `library`。

例子：首页点「拍照识字」。相机选中文件后 `setFeature('photo')`。下面改画 `VocabularyShell`。状态机停在空闲。

左上角返回把 `feature` 设回 `null`，对话首页又出现。

```tsx
const [feature, setFeature] = useState<null | 'photo' | 'library'>(null);

// 词卡里的返回
onClick={() => {
  setOpeningFile(null);
  setFeature(null);
}}

// 首页相机选中一张图
onChange={(event) => {
  const file = event.target.files?.[0] ?? null;
  event.target.value = '';
  if (!file) return;
  setOpeningFile(file);
  setFeature('photo');
}}
```

## 顶栏

任务进行中、并且这一轮还没送达时，左边是取消，右边可以换方向。齿轮打开 `DevPanel`，那是给成人的，不参与儿童流程。

```tsx
const taskActive = task !== null && screen !== 'switch';
const delivered = snap.matches({ task: { result: 'delivered' } });
const showTaskControls = taskActive && !delivered;

onClick={() => send({ type: 'CANCEL' })}
onClick={() => task && send({ type: 'SWITCH_REQUESTED', direction: otherDirection(task.direction) })}
onClick={() => setDevOpen(true)}
```

## 选择屏幕

`feature` 为空时，按 `screen` 渲染对应的一屏。每个屏幕都收到 `snap` 和 `send`。它们不修改任务计数。`feature` 有值时，词卡盖在上面。

```tsx
{screen === 'home' && !feature && (
  <HomeScreen {...props} onPhotoCards={() => homeCameraRef.current?.click()} onMyCards={() => setFeature('library')} />
)}
{screen === 'recording' && <RecordingScreen {...props} />}
{screen === 'segmentDecision' && <SegmentDecisionScreen {...props} />}
{screen === 'busy' && <BusyScreen {...props} />}
{screen === 'clarify' && <QuestionScreen {...props} kind="clarify" />}
{screen === 'confirm' && <QuestionScreen {...props} kind="confirm" />}
{screen === 'result' && <ResultScreen {...props} />}
{screen === 'switch' && <SwitchScreen {...props} />}
{screen === 'error' && <ErrorScreen {...props} />}
{screen === 'fallback' && <FallbackScreen {...props} />}
{screen === 'asrEmpty' && !feature && <AsrEmptyScreen {...props} />}
{feature && <VocabularyShell entry={feature} openingFile={openingFile} preset={snap.context.preset} />}
```
