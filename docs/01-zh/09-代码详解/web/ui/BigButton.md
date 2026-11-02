# `apps/web/src/ui/BigButton.tsx`

源码：[BigButton.tsx](../../../../../apps/web/src/ui/BigButton.tsx)

大按钮的样子。它不决定流程。按下时调用外面传来的 `onClick`。

按钮至少 64 像素高，带按下时下沉的阴影。颜色由调用方传入，例如停止是红色，确认是绿色。

例子：录音屏把「停止」画成这个按钮。点击后 `screens.tsx` 发送 `STOP_SEGMENT`。按钮组件自己不知道 30 秒倒计时。
