# `apps/web/src/services/apiClient.ts`

源码：[apiClient.ts](../../../../../apps/web/src/services/apiClient.ts)

浏览器一侧的三个接口。形状和服务器的 `ProviderBundle` 一样，所以状态机不用知道后面是假数据还是 OpenAI。里面全是 `fetch('/api/...')`。没有 API key。

## `headersFor`

每个请求都带预设和两个编号。有会话、方向、测试码时再附加。词卡调用会加 `X-Feature: vocabulary`。

例子：mock 下识别「我想去厕所。」请求是 `POST /api/asr?language=zh`，身体是音频字节。mock 还把剧本文本放在 `X-Mock-Transcript` 里，服务器的假识别读这个头，不解析声音。

```text
线索：function headersFor
return 预设、任务编号、请求编号
  线索：X-Provider-Preset 、X-Task-Id 、X-Request-Id
```

## 四个调用

```text
线索：asr.transcribe
if (判定预设是 mock，并且音频上带了剧本文字) {
  线索：preset === 'mock' && audio.mockTranscript
  把头里的剧本文字一起送去
    线索：X-Mock-Transcript
}
把音频交给 /api/asr
if (判定返回的形状不对) 报「模型输出不合格」
  线索：AsrResponseSchema.safeParse 失败 → INVALID_MODEL_OUTPUT
return 识别出的文字
  线索：parsed.data.text

线索：dialogue.interpretChinese → /api/interpret
if (判定返回不是三种理解之一) 报「模型输出不合格」
  线索：InterpretationResultSchema.safeParse

线索：dialogue.translate → /api/translate
return 译文
  线索：parsed.data.translation

线索：tts.synthesize → /api/tts
if (判定声音是空的) 报朗读失败
  线索：bytes.length === 0 → TTS
```

## 超时和取消

默认等 45 秒。状态机取消任务时，`AbortSignal` 会把这次 `fetch` 停掉。服务器看到连接断开，也会停掉自己正在做的模型调用。

```text
线索：HttpTransport.request ，默认 45 秒是 DEFAULT_TIMEOUT_MS
if (判定状态机已经取消) 立刻停掉
  线索：signal.addEventListener('abort')
try {
  if (判定服务器返回的不是成功) 按错误种类抛出去
    线索：!response.ok → readError
  return 响应
} catch {
  if (判定已经是整理好的错误) 原样抛出
    线索：error instanceof AppError
  if (判定是超时) 报超时
    线索：timedOut → TIMEOUT
  if (判定是状态机自己取消的) 把取消交回去
    线索：signal?.aborted
  否则 报网络失败
    线索：NETWORK
}
```

`fetchHealth` 读 `/api/health`，用来知道哪一套预设可用。它不带任务编号。
