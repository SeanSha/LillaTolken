# `apps/web/src/services/apiClient.ts`

源码：[apiClient.ts](../../../../../apps/web/src/services/apiClient.ts)

浏览器一侧的三个接口。形状和服务器的 `ProviderBundle` 一样，所以状态机不用知道后面是假数据还是 OpenAI。里面全是 `fetch('/api/...')`。没有 API key。

## `headersFor`

每个请求都带预设和两个编号。有会话、方向、测试码时再附加。词卡调用会加 `X-Feature: vocabulary`。

例子：mock 下识别「我想去厕所。」请求是 `POST /api/asr?language=zh`，身体是音频字节。mock 还把剧本文本放在 `X-Mock-Transcript` 里，服务器的假识别读这个头，不解析声音。

```ts
function headersFor(preset, meta) {
  return {
    'X-Provider-Preset': preset,
    'X-Task-Id': meta.taskId,
    'X-Request-Id': meta.requestId,
  };
}
```

## 四个调用

```ts
async transcribe(audio, language, meta) {
  if (preset === 'mock' && audio.mockTranscript !== undefined) {
    extra['X-Mock-Transcript'] = encodeURIComponent(audio.mockTranscript);
  }
  const response = await http.request(`/api/asr?language=${language}`, { method: 'POST', body: audio.bytes }, meta.signal);
  const parsed = AsrResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad ASR response');
  return parsed.data.text;
}

async interpretChinese(input, meta) {
  const response = await http.request('/api/interpret', jsonInit(meta, input), meta.signal);
  const parsed = InterpretationResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad interpretation response');
  return parsed.data;
}

async translate(input, meta) {
  const response = await http.request('/api/translate', jsonInit(meta, input), meta.signal);
  const parsed = TranslateResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad translation response');
  return parsed.data.translation;
}

async synthesize(text, language, meta) {
  const response = await http.request('/api/tts', jsonInit(meta, { text, language }), meta.signal);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new AppError('TTS', 'empty audio');
  return { bytes, mimeType: response.headers.get('content-type') ?? 'audio/mpeg' };
}
```

## 超时和取消

默认等 45 秒。状态机取消任务时，`AbortSignal` 会把这次 `fetch` 停掉。服务器看到连接断开，也会停掉自己正在做的模型调用。

```ts
async request(path, init, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, this.timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort());
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok) throw await readError(response);
    return response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (timedOut) throw new AppError('TIMEOUT', 'request timed out');
    if (signal?.aborted) throw error;
    throw new AppError('NETWORK', 'network request failed');
  } finally {
    clearTimeout(timer);
  }
}
```

`fetchHealth` 读 `/api/health`，用来知道哪一套预设可用。它不带任务编号。
