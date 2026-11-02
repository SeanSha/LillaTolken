# `apps/web/src/audio/session.ts`

源码：[session.ts](../../../../../apps/web/src/audio/session.ts)

只为 iPhone 的音频路线。播完一句再录音时，系统可能还停留在「播放」路线，麦克风会打开但没有声音。

`setAudioSession('play-and-record')` 在开始录音前切换路线。播译文之前再设回 `auto`，让声音从扬声器出来，而不是听筒。

例子：确认句刚播完，马上录纠正。没有这次切换，下一段可能是空的，状态机会以为没听清。桌面浏览器没有这个对象时，函数直接返回。
