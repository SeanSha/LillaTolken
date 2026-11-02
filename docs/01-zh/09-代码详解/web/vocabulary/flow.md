# `apps/web/src/vocabulary/flow.ts`

源码：[flow.ts](../../../../../apps/web/src/vocabulary/flow.ts)

一张照片识别完之后，画面该去哪。这里没有状态机。

## `stepAfterIdentify`

- 是人，或照片里没有物体：`blocked`。不出现名字。
- 不确定，或没有候选人：进入草稿，但词是空的，不编造。
- 好几个物体：`choose`，等孩子或成人点一个。
- 正好一个：进入草稿，带上中文、瑞典语、冠词和分类。

例子：拍到杯子。结果是一个物体，草稿里中文是「杯子」。拍到人脸，得到 `blocked`，保存按钮不会把人名写成卡片。

`claimRecognition` 保证第一次识别还没回来时，再点一次不会发出第二个请求。
