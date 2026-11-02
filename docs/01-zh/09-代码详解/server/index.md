# `apps/server/src/index.ts`

源码：[index.ts](../../../../apps/server/src/index.ts)

Node 进程的起点。读 `.env`，做出三套实现，听端口。

默认地址是 `127.0.0.1`。手机不直接连这个端口，而是通过网页开发服务器把 `/api` 转过来。

启动时会在终端打印哪几套预设可用。没有 OpenAI 密钥就说明 cloud 关掉了。local 不可用时提示去跑 `npm run local:doctor`。

监控密码如果是第一次随机生成的，只在这里打印一次，并写到权限 0600 的文件。之后再启动不再打印。
