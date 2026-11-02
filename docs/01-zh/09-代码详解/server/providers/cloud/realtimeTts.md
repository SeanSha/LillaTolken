# `apps/server/src/providers/cloud/realtimeTts.ts`

源码：[realtimeTts.ts](../../../../../../apps/server/src/providers/cloud/realtimeTts.ts)

云端朗读的实时通道。`usesRealtimeTts` 看模型名是不是 `gpt-realtime` 开头。

它把要读的文本送进去，收集返回的音频，拼成 WAV。`usageFromRealtime` 把输入、输出 token 分成文字和音频，交给监控计价。

连接失败或中途断开，变成 `NETWORK` 或 `TTS` 错误。状态机可以重试，或让成人只看文字。

例子：默认声音 `alloy` 读一句瑞典语。成功时监控的费用依据可以是 `reported_usage`。这和旧接口「永远 Unknown」不同。
