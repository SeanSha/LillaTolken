# `packages/shared/src/vocabulary.ts`

源码：[vocabulary.ts](../../../../packages/shared/src/vocabulary.ts)

词卡识别结果和卡片的形状。对话状态机不用这些类型。

识别结果 `outcome` 可以是一个物体、多个物体、不确定、是人、或什么都没有。候选人有中文、瑞典语、冠词和学前分类。

例子：拍一个苹果。结果是一个物体，中文「苹果」，瑞典语可能是「ett äpple」，分类是食物。拍到人脸时，结果是 `person`，没有人名栏可以填。

分类包括动物、食物、玩具、衣服、家居、学校、自然、交通工具，认不准就是其他。
