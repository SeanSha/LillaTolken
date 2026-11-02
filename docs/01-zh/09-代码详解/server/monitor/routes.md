# `apps/server/src/monitor/routes.ts`

源码：[routes.ts](../../../../../apps/server/src/monitor/routes.ts)

`/api/monitor/*` 的路由。除了登录、登出和查询会话，都要管理员 cookie。本地健康、事件导出和删除也从这里要求登录。

有概览、请求、任务、时间序列、价格、标注、测试场次、对比、导出和清空。清空要在身体里再次确认。

例子：没登录就打开请求列表。响应是 401。登录后再请求同一路径，得到分页 JSON。这些 JSON 里没有原文。
