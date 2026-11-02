# `apps/web/src/monitor/MonitorApp.tsx`

源码：[MonitorApp.tsx](../../../../../apps/web/src/monitor/MonitorApp.tsx)

`/monitor` 的整页。`main.tsx` 只在这个地址加载它。它和儿童状态机不是同一个 React 树。

## `Login`

没有默认密码。密码来自 `.env` 的 `MONITOR_ADMIN_PASSWORD`，或第一次启动时打印在终端里的随机密码。登录成功后，浏览器拿到一个 HttpOnly cookie。

## `Dashboard`

登录后是标签：概览、请求、任务、测试场次、评估、费用。顶上可以选 3、4、5 秒刷新，或暂停。过滤条件放在 `context.tsx`。

例子：用 mock 走完「我想去厕所。」然后打开 `/monitor` 的请求页。能看到 ASR、INTERPRET、TRANSLATE、TTS 几行耗时。点开一行，看不到那句中文。
