# `packages/shared/src/types.ts`

源码：[types.ts](../../../../packages/shared/src/types.ts)

浏览器和服务器共用的词。改限额只改这里，两边一起生效。

## `LIMITS`

```ts
segmentSeconds: 30
semanticClarifications: 3
correctionAttempts: 2
asrRetries: 2
```

例子：一段录音到 30 秒必须停。追问第 4 次不会发生，因为状态机拿 3 来比较。

## 方向和语言

`ZH_TO_SV` 表示孩子说中文、最后听到瑞典语。`languageOfSpeaker` 在这个方向返回 `zh`，识别就按中文做。`targetLanguage` 返回 `sv`，朗读用瑞典语。

`otherDirection` 把方向对调。换方向按钮用它。

## `DialogueInput` 和 `LastDelivered`

`DialogueInput` 是已经听写的文本，按段排列，可以标明它在回答哪一个问题。音频不在这里。

`LastDelivered` 只留上一句已经送达的话：原文和译文各一句。默认不留整段历史。

## `PAYLOAD_LIMITS`

音频最大约 10 MB，文本最长 2000 字。服务器用这些数字拒绝过大的请求。
