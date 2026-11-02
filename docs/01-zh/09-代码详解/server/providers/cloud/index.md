# `apps/server/src/providers/cloud/index.ts`

源码：[index.ts](../../../../../../apps/server/src/providers/cloud/index.ts)

OpenAI 这一套：识别、理解、翻译、朗读。密钥只在服务器配置里。浏览器调用的仍是 `/api/asr` 这些路由。

## 识别

`gpt-transcribe` 使用 `languages` 数组。中文送 `cmn`，不再使用旧的单个 `language` 字段。

## 理解和翻译

使用配置里的对话模型，默认 `gpt-6-luna`。要求 JSON。返回交给 `dialogueParsing.ts` 检查。`gpt-6` 这一类会省略 `temperature`，因为默认推理强度不接受这个参数。

## 朗读

模型名以 `gpt-realtime` 开头时走 `realtimeTts.ts`，只把译文文本送进去，拿回 WAV，并尽量带回 token。改回 `gpt-4o-mini-tts` 才用旧的语音接口，那种接口常常没有用量。

例子：cloud 下确认了「我想去厕所」。`translate` 得到瑞典语，`synthesize` 用实时语音读出来。监控能看到这次的 token。密钥不会出现在返回的 JSON 里。
