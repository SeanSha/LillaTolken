# `apps/web/src/dialogue/machine.ts`

源码：[machine.ts](../../../../../apps/web/src/dialogue/machine.ts)

这是项目里唯一决定「下一步做什么」的文件。界面只发事件。模型只返回三种理解结果。次数、确认、换方向，都在这里。

例子贯穿全文：孩子要表达「我想去厕所。」方向是中文到瑞典语。

## 文件开头：依赖和过期结果

`createDialogueMachine(deps)` 接收外面传进来的零件：录音机、音频库、播放、HTTP、记日志。状态机自己不 `fetch`。

`isStale` 比较返回结果上的 `taskId`、`requestId` 和当前任务。对不上就丢掉。

例子：孩子已经点了取消，识别结果才回来。`requestId` 已经换过，这条结果不能把界面拉回去。

```text
线索：const isStale
if (判定返回上的请求编号，或任务编号，对不上当前这一轮) {
  线索：out.requestId !== activeRequestId 或 out.taskId !== task.id
  return 丢掉，不改界面
}

线索：beginTask
function 开始一轮(方向) {
  线索：preset: ctx.preset
  预设抄下现在的，这一轮不再改
  线索：clarificationCount / correctionCount / asrRetryCount 都从 0
  线索：proposedMeaning: null ，confirmedMeaning: null
}
```

## `idle`：空闲，也就是首页

等待 `START_TASK`。事件里带着方向。

进入任务时，预设被复制进 `task.preset`，这一轮不能再换。计数器从 0 开始。`SET_PRESET` 只在空闲时接受。任务进行中改预设会被忽略。空闲时如果直接要求换方向，不再追问，当作开始那一个方向。

```text
线索：id: 'idle'
收到「开始任务」→ 进入录音
  线索：START_TASK → #recording ，beginTask
收到「换方向」→ 同样直接进入录音
  线索：SWITCH_REQUESTED → #recording
收到「改预设」→ 只改预设，留在首页
  线索：SET_PRESET
```

## `recording`：录音

先播放短句「请说吧」，然后打开麦克风。一段最长 30 秒，数字来自 `LIMITS.segmentSeconds`。

孩子可以：

- `STOP_SEGMENT`：自己点停止。
- `SEGMENT_TIMEOUT`：30 秒到了，只结束这一段。
- `SKIP_PROMPT`：短句还在说时跳过。

静音不会自动结束。停下来之后进入 `segmentDecision`。

mock 时，录音机交给状态机的是场景剧本，不是真实声波。状态机不关心声音从哪来，它只收下一段音频。

```text
线索：id: 'recording' ，initial: 'prompting'
先播放「请说吧」
  线索：src: 'speakPrompt'
if (判定短句说完，或者点了跳过，或者短句没播出来) {
  线索：onDone / SKIP_PROMPT / onError → 'starting'
  打开麦克风
    线索：src: 'startRecording'
}
if (判定麦克风打不开) {
  线索：onError → #recoverableError
  return
}
听着 {
  线索：id 在 listening
  if (判定点了停止，或者到了 30 秒) {
    线索：STOP_SEGMENT 或 segmentTimeout → finalizing
    停下后进入「继续说，还是说完了」
      线索：src: 'stopRecording' → #segmentDecision
  }
}
```

## `segmentDecision`：继续，还是说完

两个事件：

- `CONTINUE_SPEAKING`：再录一段，仍是同一个任务。
- `FINISH_INPUT`：把已经录下的各段送去识别。

例子：「老师……」「他把我的……」「水壶拿走了。」是三段，一次 `FINISH_INPUT`，一次翻译。

```text
线索：id: 'segmentDecision'
收到「继续」→ 再录一段
  线索：CONTINUE_SPEAKING → #recStarting
收到「说完了」→ 去识别
  线索：FINISH_INPUT → #transcribing
```

## `transcribing`：按顺序识别

调用装配好的 `transcribe`。成功后看方向：

- `SV_TO_ZH`：去 `translating`。没有理解和确认。
- 其他，也就是中文到瑞典语：去 `interpreting`。

识别为空，并且 `asrRetryCount < 2`：去 `asrEmpty`，请再说一次。已经满 2 次：去 `fallback`，不再猜。

识别完，`audioStore` 里这一轮的段落被清掉。空识别走的是 `onError`，错误类别是 `ASR_EMPTY`，不是成功返回一个空字符串。

```text
线索：id: 'transcribing' ，src: 'transcribe'
成功时，在 onDone 里按顺序看 {
  if (判定这条结果已经过期) return 丢掉
    线索：isStale
  if (判定方向是瑞典语到中文) 去翻译
    线索：direction === 'SV_TO_ZH' → #translating
  否则 去理解中文
    线索：target: '#interpreting'
}
失败时，在 onError 里看 {
  if (判定是没听清，并且还不到 2 次) 去再录一次
    线索：error === 'ASR_EMPTY' && asrRetryCount < LIMITS.asrRetries → #asrEmpty
  if (判定仍是没听清) 去兜底
    线索：ASR_EMPTY → #fallback
  否则 去还能重试的错误
    线索：#recoverableError
}
```

## `interpreting`：理解中文

调用 `interpret`。交给模型的包括已经听写的句子，以及还剩几次追问：`3 - clarificationCount`。

返回之后：

- `ASK_CLARIFICATION` 并且次数还不到 3：去 `clarifying`，次数加 1。
- 仍是 `ASK_CLARIFICATION`：说明已经没有名额了，去 `fallback`。
- `PROPOSE_MEANING`：把提出的中文意思记下，去 `confirming`。
- `UNRESOLVED`：去 `fallback`。

例子：「我想去厕所。」通常直接得到提出的意思，次数保持 0。

例子：「他拿走了我的那个。」可能得到一个短问题。界面只显示这一个问题。第 4 个问题不会出现，因为次数已经到 3 时走兜底。

```text
线索：id: 'interpreting' ，src: 'interpret'
把听写和还剩几次追问交给模型
  线索：remainingClarifications: 3 - clarificationCount
返回时，在 onDone 里按顺序看 {
  if (判定这条结果已经过期) return 丢掉
    线索：isStale
  if (判定要追问，并且次数还不到 3) 去问这一个问题，次数加 1
    线索：kind === 'ASK_CLARIFICATION' && clarificationCount < LIMITS.semanticClarifications → #clarifying
  if (判定还要追问) 去兜底
    线索：ASK_CLARIFICATION → #fallback ，原因 CLARIFICATION_LIMIT
  if (判定提出了一个意思) 记下意思，去确认
    线索：kind === 'PROPOSE_MEANING' → #confirming
  否则 去兜底
    线索：fallbackReason: 'UNRESOLVED'
}
```

## `clarifying`：问一个短问题

播放这个问题。孩子点 `START_ANSWER` 后回到录音。这一段的用途标成 `CLARIFICATION`，仍然是同一个任务，不是新的一轮。问句的语音没合成出来，仍进入提问屏，大人可以看字。

```text
线索：id: 'clarifying'
先把这个短问题读出来
  线索：src: 'synthesize' ，synthInput('question')
if (判定语音没读出来) 仍进入提问
  线索：onError 也到 'asking'
孩子点回答 → 回到录音，这一段算作回答
  线索：START_ANSWER → #recording ，beginInput('CLARIFICATION')
```

## `confirming`：必须点是，才翻译

`text.ts` 把意思说成「你是说：我想去厕所，对吗？」

- `CONFIRM_YES`：记下 `confirmedMeaning`，去 `translating`。
- `CONFIRM_NO`：次数不到 2 时回到录音，用途是 `CORRECTION`。
- 已经纠正过 2 次：去 `fallback`。

```text
线索：id: 'confirming'
先朗读确认句
  线索：synthInput('confirmation')
if (判定这句话没读出来) 仍进入确认屏
  线索：onError 也到 'asking'
点是 → 记下确认过的意思，去翻译
  线索：CONFIRM_YES → #translating ，confirmedMeaning
点不是 {
  if (判定改正还不到 2 次) 回到录音
    线索：correctionCount < LIMITS.correctionAttempts ，inputPurpose: 'CORRECTION'
  否则 去兜底
    线索：fallbackReason: 'CORRECTION_LIMIT'
}
```

## `translating`：翻译

调用 `translate`。中文到瑞典语时，翻译的文本是确认过的中文意思，不是最初没确认的识别稿。然后进入 `result`。

```text
线索：id: 'translating' ，src: 'translate'
if (判定方向是中文到瑞典语) 翻译已经确认的那句
  线索：direction === 'ZH_TO_SV' ? confirmedMeaning
否则 翻译刚识别出的原文
  线索：sourceText
成功 → 去结果
  线索：onDone → #result
失败 → 去还能重试的错误
  线索：onError → #recoverableError
```

## `result`：结果

播放目标语言。播放结束或成人接受纯文字时，发出 `DELIVERY_FINISHED`。这时才把这句话记成 `lastDelivered`。只是接口返回了译文，还不会记住。

`NEW_TURN` 回到空闲。也可以直接再开始另一个方向。

```text
线索：id: 'result'
先把译文读出来
  线索：synthInput('result')
读出来了 → 等播放结束
  线索：onDone → 'pending'
没读出来 → 字还在
  线索：onError → 'ttsFailed'
if (判定声音已经播完) 记成已经送达
  线索：DELIVERY_FINISHED ，mode === 'audio' → 'delivered'
if (判定朗读失败，并且接受只看文字) 也记成已经送达
  线索：mode === 'text_only'
点回首页 → 回到空闲
  线索：NEW_TURN → #idle
点再来一轮 → 再进入录音
  线索：delivered 里的 START_TASK → #recording
```

## `recoverableError` 和 `fallback`

网络、超时、模型 JSON 不合法，进入 `recoverableError`。`RETRY` 回到失败的那一步：识别、理解、翻译或录音。

问满、纠正满、空识别满，进入 `fallback`。可以 `RESTART` 同一方向重来，或 `CANCEL` 回首页。失败的任务不会被记成已送达。

```text
线索：id: 'recoverableError'
点重试 {
  if (判定失败在识别) 回到识别
    线索：error.stage === 'asr' → #transcribing
  if (判定失败在理解) 回到理解
    线索：stage === 'interpret' → #interpreting
  if (判定失败在翻译) 回到翻译
    线索：stage === 'translate' → #translating
  否则 回到录音
    线索：RETRY → #recording
}

线索：id: 'fallback'
点重新开始 → 用同一方向再开一轮
  线索：RESTART → #recording ，beginTask
```

## `confirmingSwitch`：任务中途换方向

录音或识别过程中发来 `SWITCH_REQUESTED`。先问要不要换。

- `SWITCH_NO`：回到刚才的检查点，已录的段落和计数还在。
- `SWITCH_YES`：丢掉这一轮未完成的任务，按新方向重新开始。上一句已经送达的话还留着。

空闲和已经送达时换方向，不再问这一句。

```text
线索：id: 'confirmingSwitch'
点换 {
  丢掉这一轮还没做完的内容，按新方向重新录音
  线索：SWITCH_YES → #recording ，beginTask(pendingDirection)
}
点留下 {
  if (判定刚才停在识别) 回到识别
    线索：safeReturnState === 'transcribing'
  if (判定刚才停在确认) 回到确认
    线索：safeReturnState === 'confirming'
  否则 回到录音
    线索：SWITCH_NO 的最后一条 → #recording
}
```

## 读的时候可以只盯一个例子

用 mock 打开首页，选场景 T01「我想去厕所。」点说中文，点停止，点说完，点是。对照上面的状态名：`idle` → `recording` → `segmentDecision` → `transcribing` → `interpreting` → `confirming` → `translating` → `result`。
