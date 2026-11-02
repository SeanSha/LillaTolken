# `packages/shared/src/contracts.ts`

源码：[contracts.ts](../../../../packages/shared/src/contracts.ts)

三套预设必须长成同一个形状。这个文件定义那个形状。

## 三个接口

- `SpeechRecognizer.transcribe`：音频进去，文本出来。
- `DialogueModel.interpretChinese`：中文对话进去，得到追问、提出意思或无法判断。
- `DialogueModel.translate`：一句文本加方向进去，译文出来。
- `SpeechSynthesizer.synthesize`：文本进去，音频出来。

`ProviderBundle` 把三者包在一起。mock、cloud、local 各有一份。浏览器的 `apiClient` 也实现同一份，只是里面是 HTTP。

## `InterpretationResult`

例子：

```ts
{ kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所' }
{ kind: 'ASK_CLARIFICATION', questionZh: '他拿走了什么？', reasonCode: '...' }
{ kind: 'UNRESOLVED', reasonCode: '...' }
```

状态机只根据 `kind` 分支。模型不能在这里把 `clarificationCount` 改成 0。

## `RequestMeta`

每次调用带 `taskId` 和 `requestId`。可选的 `report` 用来交回 token 和耗时，给监控用。不要把原句放进这个对象的用量字段。

`mockTranscript` 只给 mock。真的 cloud 和 local 会忽略它。
