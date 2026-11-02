# `packages/shared/src/index.ts`

源码：[index.ts](../../../../packages/shared/src/index.ts)

这个文件自己没有逻辑。它把同一包里的类型、错误、接口、校验、评估事件、mock 剧本、监控类型和词卡类型一起导出。

应用代码写 `import { LIMITS } from '@kt/shared'`，不用记住每个小文件的路径。

例子：状态机和服务器都从这里拿到 `LIMITS.semanticClarifications`，所以「最多 3 次追问」只有一份数字。
