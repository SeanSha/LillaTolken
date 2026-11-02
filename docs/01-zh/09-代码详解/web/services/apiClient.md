# `apps/web/src/services/apiClient.ts`

源码：[apiClient.ts](../../../../../apps/web/src/services/apiClient.ts)

浏览器一侧的三个接口。形状和服务器的 `ProviderBundle` 一样，所以状态机不用知道后面是假数据还是 OpenAI。里面全是 `fetch('/api/...')`。没有 API key。

## `headersFor`

每个请求都带预设和两个编号。有会话、方向、测试码时再附加。词卡调用会加 `X-Feature: vocabulary`。

例子：mock 下识别「我想去厕所。」请求是 `POST /api/asr?language=zh`，身体是音频字节。mock 还把剧本文本放在 `X-Mock-Transcript` 里，服务器的假识别读这个头，不解析声音。

```text
function 请求头(预设, 这一轮, 这一次调用) {
  return 预设、任务编号、请求编号
}
```

## 四个调用

```text
function 识别(音频, 语言) {
  if (判定预设是 mock，并且音频上带了剧本文字) {
    把头里的剧本文字一起送去
  }
  把音频交给 /api/asr
  if (判定返回的形状不对) 报「模型输出不合格」
  return 识别出的文字
}

function 理解(听写和还剩几次追问) {
  交给 /api/interpret
  if (判定返回不是追问、提出意思、无法判断这三种之一) 报「模型输出不合格」
  return 理解结果
}

function 翻译(要译的文本和方向) {
  交给 /api/translate
  if (判定返回里没有译文) 报「模型输出不合格」
  return 译文
}

function 朗读(文本, 语言) {
  交给 /api/tts
  if (判定拿回来的声音是空的) 报朗读失败
  return 音频
}
```

## 超时和取消

默认等 45 秒。状态机取消任务时，`AbortSignal` 会把这次 `fetch` 停掉。服务器看到连接断开，也会停掉自己正在做的模型调用。

```text
function 发请求(路径) {
  开始计时，默认 45 秒
  if (判定状态机已经取消) 立刻停掉这次请求
  try {
    发出请求
    if (判定服务器返回的不是成功) 按错误种类抛出去
    return 响应
  } catch {
    if (判定已经是整理好的错误) 原样抛出
    if (判定是超时) 报超时
    if (判定是状态机自己取消的) 把这次取消交回去，不当成网络故障
    否则 报网络失败
  }
}
```

`fetchHealth` 读 `/api/health`，用来知道哪一套预设可用。它不带任务编号。
