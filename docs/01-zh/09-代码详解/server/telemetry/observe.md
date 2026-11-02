# `apps/server/src/telemetry/observe.ts`

源码：[observe.ts](../../../../../apps/server/src/telemetry/observe.ts)

包住每一套实现的每一次调用。成功、失败、取消、超时各写一行。写监控失败时，原来的结果或错误照样返回，不会被吞掉。

行里有阶段、预设、模型名、耗时、token、费用依据。没有提示词、原文、译文和音频。

例子：cloud 翻译抛了网络错误。界面看到错误，数据库里仍有一行 `failed`。孩子说的句子不在这行里。
