# `apps/web/src/audio/prompts.ts`

源码：[prompts.ts](../../../../../apps/web/src/audio/prompts.ts)

界面自己说的短句，不经过翻译模型。

## 文案

`PROMPT_TEXT` 里每种提示有中文和瑞典语。例如开始是「请说吧」/「Varsågod」，没听清是「没听清，再说一次好吗？」。

## `SpeechPrompts.speak`

优先播放事先做好的 mp3。失败才用浏览器的 `speechSynthesis`。最长大约 6 秒。快结束前约 250 毫秒可以通知录音机预热。

例子：进入录音。状态机调用 `speakPrompt('start', 'zh')`。孩子听到「请说吧」，然后麦克风打开。这句不是孩子要翻译的内容，也不会写进监控原文。
