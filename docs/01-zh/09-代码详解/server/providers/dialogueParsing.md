# `apps/server/src/providers/dialogueParsing.ts`

源码：[dialogueParsing.ts](../../../../../apps/server/src/providers/dialogueParsing.ts)

cloud 和 local 的模型输出都从这里过。mock 的结果已经是规定好的形状，不必再猜。

## `parseJson`

空字符串或不是 JSON，抛出 `INVALID_MODEL_OUTPUT`。

## `parseInterpretation`

只接受三种 `kind`。还要再看剩余追问次数。模型在次数已经是 0 时仍返回追问，这里改成 `UNRESOLVED`。状态机因此不会展示第 4 个问题。

例子：模型返回一段带前后废话的文字，解析失败。界面走到可恢复错误，可以重试，不会把废话当成孩子的意思。
