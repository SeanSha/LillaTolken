# `apps/server/src/media/duration.ts`

源码：[duration.ts](../../../../../apps/server/src/media/duration.ts)

从 WAV 头算出音频有多少毫秒。这个数字给监控当「这段声音多长」，不是模型算了多久。

例子：`say` 生成了 2 秒的瑞典语。这里得到大约 2000。请求耗时可能是 400 毫秒。两列不要混在一起。
