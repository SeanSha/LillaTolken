# `apps/web/src/main.tsx`

源码：[main.tsx](../../../../apps/web/src/main.tsx)

浏览器打开页面时，这个文件最先运行。它看地址，决定加载儿童界面还是监控页。两边不会一起加载，所以监控页不会把麦克风和状态机也拉进来。

## `start`

地址是 `/monitor` 时，动态加载 `MonitorApp` 和监控样式。

其他地址加载 `App` 和儿童界面的样式。

例子：手机打开 `https://192.168.x.x:5173/`，走 `App`。打开同一地址加上 `/monitor`，只走监控登录。

这里不用 React 的 StrictMode。状态机要管麦克风，同一段副作用只能跑一次。
