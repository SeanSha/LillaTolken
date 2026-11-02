# `apps/web/src/main.tsx`

源码：[main.tsx](../../../../apps/web/src/main.tsx)

浏览器打开页面时，这个文件最先运行。它看地址，决定加载儿童界面还是监控页。两边不会一起加载，所以监控页不会把麦克风和状态机也拉进来。

## `start`

地址是 `/monitor` 时，动态加载 `MonitorApp` 和监控样式，然后 `return`。

其他地址加载 `App` 和儿童界面的样式。

例子：手机打开 `https://192.168.x.x:5173/`，走 `App`。打开同一地址加上 `/monitor`，只走监控登录。

这里不用 React 的 StrictMode。状态机要管麦克风，同一段副作用只能跑一次。

```text
async function start() {
  if (判定打开的网页地址尾部是否有 /monitor 或者 /monitor/) {
    只加载监控页和监控样式
    显示监控登录
    return
  }
  加载儿童界面和儿童样式
  // 不用 StrictMode：状态机要管麦克风，同一段副作用只能跑一次
  显示儿童界面
}
```

外形仍是原来的 `if` 和 `return`。括号里写成这一步在判定什么，不再把源码那一行原样抄上。
