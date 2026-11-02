# `apps/web/src/dialogue/types.ts`

源码：[types.ts](../../../../../apps/web/src/dialogue/types.ts)

这一页是状态机的笔记本格式。它不执行流程，只规定本子上有哪些栏，以及按钮可以发出哪些事件。

## `Task`：一轮对话

一轮翻译是一个 `Task`。

- `direction`：`ZH_TO_SV` 或 `SV_TO_ZH`。
- `preset`：开始时冻结的 mock、cloud 或 local。
- `inputPurpose`：现在录的是开头、追问的回答，还是纠正。
- `dialogueInputs`：已经听写出来的文本，按段排好。音频本身不在这里。
- `proposedMeaning`：模型提出、还没确认的中文意思。
- `confirmedMeaning`：孩子点了「是」之后的中文意思。
- `clarificationCount`、`correctionCount`、`asrRetryCount`：三个分开的计数。

例子：T01 点了「是」以后，`confirmedMeaning` 是「我想去厕所」，`clarificationCount` 仍是 0。

## `MachineContext`：整台机器的记忆

`task` 是当前这一轮，空闲时是 `null`。`lastDelivered` 是上一句已经播放完的话，最多留一句。`activeRequestId` 用来丢掉过期结果。`safeReturnState` 是换方向时选「不换」要回到的地方。

## `DialogueEvent`：界面可以发的事件

每一个按钮对应一种 `type`。例如首页是 `START_TASK`，说完是 `FINISH_INPUT`，确认是 `CONFIRM_YES` 或 `CONFIRM_NO`。

屏幕组件只负责选出这些事件，不负责改上面的计数。

## `DialogueDeps`：外面要交进来的零件

录音机、音频库、按预设取 HTTP、播放短句、写日志。`machine.ts` 通过这些名字调用它们。换实现时改 `runtime.ts`，不必改状态定义。
