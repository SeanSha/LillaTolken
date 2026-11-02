# `apps/web/src/vocabulary/identity.ts`

源码：[identity.ts](../../../../../apps/web/src/vocabulary/identity.ts)

判断两张卡片是不是同一个词。比较前会做整理，例如去掉多余空格、统一大小写。

例子：已有「苹果」。新识别又得到「苹果」。整理后相同，就打开旧卡片，而不是再存一张。
