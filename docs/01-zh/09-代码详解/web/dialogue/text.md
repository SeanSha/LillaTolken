# `apps/web/src/dialogue/text.ts`

源码：[text.ts](../../../../../apps/web/src/dialogue/text.ts)

整个文件只有一个函数。确认之前，把模型提出的中文意思说成一句问话。

```text
confirmationPrompt(meaning) {
  meaning.trim().replace(句尾的句号、问号和空格)
  return `你是说：${meaning}，对吗？`
}
```

句尾的句号会被拿掉，避免听起来像「厕所。。对吗」。

状态机在确认屏播放这句话。例如 `confirmationPrompt('我想去厕所。')` 得到「你是说：我想去厕所，对吗？」。界面也可以把同一句显示给旁边的成人看。翻译用的瑞典语不在这个文件里。
