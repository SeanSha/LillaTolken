# `apps/web/src/vocabulary/capture.ts`

源码：[capture.ts](../../../../../apps/web/src/vocabulary/capture.ts)

打开相机或相册。拍照用后置摄像头 `capture="environment"`，这样 iPhone 会直接进相机，而不是先弹出「拍照还是相册」。

例子：首页点拍照识字。`fileInputProps('camera')` 让文件输入直接调相机。预览页上的「从相册选」是相机不能用时的后备。
