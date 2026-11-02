# `apps/web/src/monitor/context.tsx`

源码：[context.tsx](../../../../../apps/web/src/monitor/context.tsx)

所有标签共用的筛选：今天、近 7 天、近 30 天、全部或自定义；预设；方向；阶段。

每个标签只用自己需要的那几项。`resolveFilters` 把「今天」换成具体的起止时间再发给服务器。

例子：在概览选「近 7 天」和 local。请求页仍能看到同一组条件，不用重选。
