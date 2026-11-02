# `apps/server/src/telemetry/pricing.ts`

源码：[pricing.ts](../../../../../apps/server/src/telemetry/pricing.ts)

读 `apps/server/config/prices.json`，把 token 或音频分钟换成美元。文件改动后按修改时间重新加载，不用重启才一定生效。

没有单价或没有用量时，结果是 `unknown`，金额是空。本地调用是 0，依据是不适用。mock 没有云端费用。

例子：实时朗读返回了输入和输出 token。这里按 `gpt-realtime-2.1-mini` 那一行单价计算。旧的非流式语音没有用量，这一次保持 Unknown。

价格表是给人对照厂商页面用的。代码不会为了核价去联网。
