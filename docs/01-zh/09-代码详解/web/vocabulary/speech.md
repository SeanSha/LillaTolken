# `apps/web/src/vocabulary/speech.ts`

源码：[speech.ts](../../../../../apps/web/src/vocabulary/speech.ts)

朗读卡片上的词。它复用翻译用的 `POST /api/tts`，并带上 `zh` 或 `sv`。所以瑞典语会读出 `en` 或 `ett`。

第一次播放后，音频记在这张卡片上。再点一次不用重新等模型。

例子：卡片是「苹果 / ett äpple」。点 Svenska，请求的语言是 `sv`，文本含冠词。local 预设时，服务器用 macOS `say`。
