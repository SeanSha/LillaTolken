# `apps/server/src/app.ts`

源码：[app.ts](../../../../apps/server/src/app.ts)

这是 HTTP 的总入口。浏览器的 `/api/...` 都进这里。它不决定要不要追问。它只按请求头选出一套实现，调用对应函数，再把结果写回去。

## `context`

读三个头：

```text
X-Provider-Preset
X-Task-Id
X-Request-Id
```

预设默认是 `mock`。编号格式不对，直接 400。

`local` 即使当前不可用，也不会在这里改成 `cloud`。缺引擎时，后面的调用自己返回 `LOCAL_*`。

`cloud` 没有密钥时，这里会拒绝，因为这套被标成不可用。

客户端断开时，这里 abort 正在进行的上游调用。所以孩子点取消后，服务器不必把这次识别做完。

```text
线索：function context
预设 = 请求头里的预设，没有就当 mock
  线索：x-provider-preset ?? 'mock'
if (判定预设名字不认识) 直接拒绝
  线索：PresetSchema.safeParse 失败 → BAD_REQUEST
if (判定这套现在不可用，并且它不是 local) 拒绝
  线索：!available && preset !== 'local' → NOT_CONFIGURED
if (判定任务编号或请求编号不合格) 直接拒绝
  线索：!ID_RE.test(taskId)
孩子取消时，停掉这次模型调用
  线索：AbortController ，req.on('aborted')
```

## 翻译相关路由

例子：识别「我想去厕所。」

`POST /api/asr?language=zh`，身体是音频字节。`context()` 取出 mock 实现，调用 `asr.transcribe`。mock 读 `X-Mock-Transcript`，返回 `{ text: "我想去厕所。" }`。

- `POST /api/interpret`：身体是听写结果和还剩几次追问。返回三种理解之一。`PROMPT_MEMORY=off` 时，会丢掉客户端带来的上一句。
- `POST /api/translate`：返回 `{ translation }`。
- `POST /api/tts`：返回音频字节。
- `GET /api/health`：哪几套预设可用，以及版本号。没有密钥。

这些路由没有登录。

```text
线索：app.post('/api/asr')
读出该用哪一套
  线索：context(req)
if (判定语言不是中文或瑞典语) 拒绝
  线索：LanguageSchema
if (判定头里带了剧本文字) 交给假识别
  线索：x-mock-transcript
调用这一套的识别
  线索：bundle.asr.transcribe
返回文字
  线索：res.json({ text })

线索：app.post('/api/interpret')
if (判定没有打开「记住上一句」) 丢掉上一句
  线索：config.promptMemory ? previousDelivered : null
调用理解
  线索：bundle.dialogue.interpretChinese

线索：app.post('/api/translate')
调用翻译，返回译文
  线索：bundle.dialogue.translate ，res.json({ translation })
```

## 词卡和评估

`POST /api/vocabulary/identify` 认照片。`local` 用本机视觉模型，失败不改走云端。

`POST /api/events` 收阶段事件。schema 多一个字段就拒绝，所以原文塞不进来。

`/api/eval/ping` 和 `/api/eval/rtt` 给研究时测量网络，不参与对话。

## 监控路由

`createMonitorRouter` 挂在翻译路由前面。`/api/monitor/*`、导出和清空要管理员 cookie。
