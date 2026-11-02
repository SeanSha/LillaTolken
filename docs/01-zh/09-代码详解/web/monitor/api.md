# `apps/web/src/monitor/api.ts`

源码：[api.ts](../../../../../apps/web/src/monitor/api.ts)

监控页专用的 `fetch`。路径都在 `/api/monitor/...`。未登录时服务器返回 401，这里变成 `MonitorApiError`。

`toQuery` 把时间、预设、方向、阶段拼进查询字符串。`monitorApi` 上是登录、概览、请求列表、任务详情、导出、清空等方法。

例子：请求页要第 2 页、按时间倒序。`PageQuery` 带上 `limit`、`offset`、`sort`。过滤在服务器做，不是把全部行下载到浏览器再筛。
