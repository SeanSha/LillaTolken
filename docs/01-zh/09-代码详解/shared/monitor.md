# `packages/shared/src/monitor.ts`

源码：[monitor.ts](../../../../packages/shared/src/monitor.ts)

监控页和监控接口共用的类型：一行请求、一行任务、过滤条件、费用依据。

费用依据只有四种：`reported_usage`（接口报了用量）、`estimated`（按音频时长估计）、`unknown`（算不出，不能当成 0）、`not_applicable`（mock 或本地没有云端账单）。

例子：本地一次识别成功。费用依据是 `not_applicable`，金额是 0。云端语音如果没返回用量，依据是 `unknown`，页面显示 Unknown，而不是 $0.00。

这些类型里没有原文栏。监控表格想多显示一句译文，类型上就加不进去。
