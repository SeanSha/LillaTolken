# `packages/shared/src/schemas.ts`

源码：[schemas.ts](../../../../packages/shared/src/schemas.ts)

用 Zod 检查 JSON 的形状。服务器在调用模型之前、以及模型返回之后，都过这些规则。形状不对就拒绝，不会猜。

## 请求

- `InterpretRequestSchema`：至少一段已听写文本，以及还剩几次追问。
- `TranslateRequestSchema`：一句文本加方向。
- `TtsRequestSchema`：要朗读的文本和语言 `zh` 或 `sv`。
- `PresetSchema`：只接受 `mock`、`cloud`、`local`。

例子：有人给 `/api/interpret` 传了 `{ "transcript": "我想去厕所" }`。字段名不对，`safeParse` 失败，服务器返回 400。状态机收不到一个编造出来的意思。

文本长度不能超过 `PAYLOAD_LIMITS.maxTextChars`（2000）。理解结果还必须是追问、提出意思、无法判断这三种之一。
