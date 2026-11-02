# `apps/web/vite.config.ts`

源码：[vite.config.ts](../../../../apps/web/vite.config.ts)

开发时的网页服务器。`npm run dev` 里的 web 这一半就是它。它不负责翻译，只负责把页面送到手机，并把 `/api` 转到本机的 Node。

## 为什么默认是 HTTPS

iPhone 的 Safari 只在安全地址上开放麦克风。所以这里默认开 HTTPS。

三种情况：

1. 仓库里有 `certs/dev.pem` 和 `certs/dev-key.pem`：用这对你自己信任的证书。手机警告最少。
2. 没有这对文件：用一次性的自签名证书。Safari 会警告，接受一次即可。
3. 启动前设了 `HTTPS=off`：用普通 HTTP。电脑上的 localhost 可以，真机麦克风通常不行。

例子：同一台 Mac 上用 Chrome 打开 `https://localhost:5173`，点「说中文」，浏览器会问麦克风。用 `http://` 打开同一页，iPhone 上常常直接没有麦克风。

## 谁可以打开这个地址

`host: true` 让局域网里的手机也能连上，端口是 `5173`。Vite 会拒绝它不认识的 Host，防止别人用域名把请求转过来。`localhost` 和 IP 一直可以。`*.ts.net` 是为了用 Tailscale 远程试。还要放行别的名字，就在启动命令前加 `ALLOWED_HOSTS=名字1,名字2`。

## `/api` 转到哪

浏览器请求 `https://手机看到的地址/api/asr`。Vite 把它转到 `http://127.0.0.1:8787`，端口可以用环境变量 `PORT` 改。`xfwd: true` 把真实客户端地址和协议带给 Node，监控才能判断「是不是本机」以及 cookie 要不要标成 Secure。

`preview` 是 `npm run build` 之后的预览，端口 `4173`，代理规则和开发时一样。
