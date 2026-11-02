# `apps/web/src/services/testSession.ts`

源码：[testSession.ts](../../../../../apps/web/src/services/testSession.ts)

研究用的测试编号。成人在监控里开一场测试，手机用一个短码加入。普通翻译不需要它。

## 短码

地址里的测试码被读下来，之后的请求头可以带 `X-Test-Code`。服务器只在这个码仍然有效时，才把任务挂到那场测试上。过期或写错的码不会挂到别人的场次。

## 往返时间

`startRttProbe` 偶尔请求 `/api/eval/ping` 和 `/api/eval/rtt`，量手机到 Mac 的网络时间。这不是模型时间。对话进行中它不改变状态机。
