# `apps/server/src/providers/mock/index.ts`

源码：[index.ts](../../../../../../apps/server/src/providers/mock/index.ts)

固定的假实现。不联网，也不随机。它让真的状态机把流程走完。

识别不看音频，读请求上的剧本文本。理解根据句子决定追问还是提出意思。剧本里的 `[EMPTY]`、`[NETWORK_ERROR]`、`[MALFORMED]` 用来故意失败，测错误屏。

例子：T01 的文本是「我想去厕所。」理解返回提出意思。翻译返回一句固定的瑞典语。朗读返回 `wav.ts` 做的短音。整个过程费用不适用。
