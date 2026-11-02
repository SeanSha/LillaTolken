# `packages/shared/src/mockScenarios.ts`

源码：[mockScenarios.ts](../../../../packages/shared/src/mockScenarios.ts)

mock 预设的剧本。每一条有编号、方向，以及按顺序「听见」的句子。内容是编的，不是儿童录音。

## `MockScript`

按场景记住说到第几句。新任务开始时 `runtime.ts` 把它倒回第一句。

例子：选 T01。第一次停止，交出「我想去厕所。」这条场景的提示写着：不用追问，但仍要点确认。

T02 有三句碎片。每点一次继续，剧本给下一句。T04 是含糊句「他拿走了我的那个。」用来看追问。剧本里的 `[EMPTY]`、`[NETWORK_ERROR]` 是给测试用的标记，mock 实现看到它们会故意失败。
