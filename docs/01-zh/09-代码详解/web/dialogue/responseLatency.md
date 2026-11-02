# `apps/web/src/dialogue/responseLatency.ts`

源码：[responseLatency.ts](../../../../../apps/web/src/dialogue/responseLatency.ts)

量一段等待：从「这句话可以开始听了」到「喇叭真的响了」。

## 两步

`arm` 记下准备好的时刻和原因，例如澄清、确认或译文。`noteAudibleStart` 在播放器真的开始时计算差值。

例子：确认句「你是说：我想去厕所，对吗？」合成完是时刻 1000，声音在时刻 1800 开始。这一次等待是 800 毫秒。再点一次重播不会重新 arm，所以不会再记一条。

这个数字进评估事件，不进模型调用那张表。模型花了多久是服务器上的另一列。
