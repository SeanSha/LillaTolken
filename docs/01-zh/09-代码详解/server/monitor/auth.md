# `apps/server/src/monitor/auth.ts`

源码：[auth.ts](../../../../../apps/server/src/monitor/auth.ts)

监控密码和会话。没有写死的默认密码。

密码来自环境变量，或第一次生成后存到 `apps/server/data/monitor-admin-password`，文件权限 0600。服务器只保存口令的 SHA-256，不把密码放进网址。

登录成功发 HttpOnly、SameSite=Strict 的 cookie。同一客户端连续失败 5 次，锁定 60 秒。

例子：密码错了 5 次。第 6 次即使改对，也要等锁定结束。伪造 `X-Forwarded-For` 不能换一个客户端身份来绕过。
