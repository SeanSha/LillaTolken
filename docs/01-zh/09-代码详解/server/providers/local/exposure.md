# `apps/server/src/providers/local/exposure.ts`

源码：[exposure.ts](../../../../../../apps/server/src/providers/local/exposure.ts)

判断一个监听地址是不是只有本机能访问。`127.0.0.1` 可以。`0.0.0.0` 或局域网 IP 会被标成暴露。

`local:doctor` 和 `local:start` 用它打印 `LAN exposure`。项目自己的 Node 默认仍只绑 `127.0.0.1`。iPhone 走的是网页服务器的 HTTPS 代理，不应该直接访问 11434 或 8080。

例子：Ollama 设置里打开了「暴露到网络」。这里报警告。关掉该选项并重启 Ollama 后，警告消失。
