# `packages/shared/src/errors.ts`

源码：[errors.ts](../../../../packages/shared/src/errors.ts)

错误先分成大类，再决定 HTTP 状态码。错误信息里不能放录音、原文或译文，因为它们可能被写进日志。

## `AppError`

例子：识别结果是空的。

```ts
throw new AppError('ASR_EMPTY', 'empty transcript')
```

状态机看到类别 `ASR_EMPTY`，就去「没听清」那一屏，而不是普通的网络错误屏。

本地引擎缺失时还会带一个代码，例如 `LOCAL_TTS_UNAVAILABLE`。监控只存这个代码，不存长错误正文。

## `httpStatusFor`

- 请求不合法 → 400
- 这套预设没配置 → 501
- 超时 → 504
- 模型输出无法解析、网络、服务器 → 502
- 识别为空 → 422

`toAppError` 把未知错误收成 `UNKNOWN`，避免把第三方的原始报错直接暴露出去。
