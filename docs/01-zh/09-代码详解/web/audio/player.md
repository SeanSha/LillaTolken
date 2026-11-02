# `apps/web/src/audio/player.ts`

源码：[player.ts](../../../../../apps/web/src/audio/player.ts)

播放服务器返回的译文或确认句。它用一个 `<audio>`，不决定下一步。

## `play`

传入音频字节，播到结束返回 `ended`。被 `stop()` 打断则返回 `stopped`。只有 `ended` 才算送达。

例子：瑞典语译文开始出声时，播放器通知 `reportAudibleStart`。若 Safari 拦住自动播放，调用方把按钮留在界面上，成人或孩子再点一次。

文件开头有一段极短的静音 wav，用来在第一次点击时解锁 iPhone 的音频。
