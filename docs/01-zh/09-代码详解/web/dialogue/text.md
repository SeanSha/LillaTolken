# `apps/web/src/dialogue/text.ts`

源码：[text.ts](../../../../../apps/web/src/dialogue/text.ts)

整个文件只有一个函数。确认之前，把模型提出的中文意思说成一句问话。

```text
线索：confirmationPrompt
function 确认句(提出的意思) {
  线索：meaning.trim().replace(句尾标点)
  去掉句尾的句号、问号和空格
  线索：`你是说：${...}，对吗？`
  return 「你是说：」加上这句意思，再加上「，对吗？」
}
```

句尾的句号会被拿掉，避免听起来像「厕所。。对吗」。

状态机在确认屏播放这句话。例如 `confirmationPrompt('我想去厕所。')` 得到「你是说：我想去厕所，对吗？」。界面也可以把同一句显示给旁边的成人看。翻译用的瑞典语不在这个文件里。
