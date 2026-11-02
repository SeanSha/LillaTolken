# `apps/web/src/services/apiClient.ts`

源码：[apiClient.ts](../../../../../apps/web/src/services/apiClient.ts)

浏览器一侧的三个接口。形状和服务器的 `ProviderBundle` 一样，所以状态机不用知道后面是假数据还是 OpenAI。里面全是 `fetch('/api/...')`。没有 API key。

## `headersFor`

每个请求都带预设和两个编号。有会话、方向、测试码时再附加。词卡调用会加 `X-Feature: vocabulary`。

例子：mock 下识别「我想去厕所。」请求是 `POST /api/asr?language=zh`，身体是音频字节。mock 还把剧本文本放在 `X-Mock-Transcript` 里，服务器的假识别读这个头，不解析声音。

```text
headersFor 返回 X-Provider-Preset、X-Task-Id、X-Request-Id
```

## 四个调用

```text
asr.transcribe {
  if (preset === 'mock' && audio.mockTranscript) 带上 X-Mock-Transcript
  POST /api/asr
  AsrResponseSchema.safeParse 失败 → INVALID_MODEL_OUTPUT
  return parsed.data.text
}

interpretChinese → POST /api/interpret
  InterpretationResultSchema.safeParse 失败 → INVALID_MODEL_OUTPUT

translate → POST /api/translate
  return parsed.data.translation

synthesize → POST /api/tts
  bytes.length === 0 → TTS
```

## 超时和取消

默认等 45 秒。状态机取消任务时，`AbortSignal` 会把这次 `fetch` 停掉。服务器看到连接断开，也会停掉自己正在做的模型调用。

```text
HttpTransport.request，超时是 DEFAULT_TIMEOUT_MS，45 秒 {
  signal 已取消 → abort
  !response.ok → readError
  error instanceof AppError → 原样抛出
  timedOut → TIMEOUT
  signal.aborted → 把取消交回去
  否则 → NETWORK
}
```

`fetchHealth` 读 `/api/health`，用来知道哪一套预设可用。它不带任务编号。
