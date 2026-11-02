# `apps/server/src/providers/contracts.ts`

源码：[contracts.ts](../../../../../apps/server/src/providers/contracts.ts)

服务器登记一份实现时还要的额外信息：模型标签、是否可用、不可用原因、每个阶段用哪个模型名。

三个函数接口本身在 `@kt/shared`。这个文件再导出它们，让 `providers/` 目录和设计文档里的位置一致。

例子：`registry` 里 cloud 的 `available` 为假，原因是没设密钥。`app.ts` 读的就是这里的字段。
