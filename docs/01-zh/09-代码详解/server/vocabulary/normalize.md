# `apps/server/src/vocabulary/normalize.ts`

源码：[normalize.ts](../../../../../apps/server/src/vocabulary/normalize.ts)

把模型返回的词整理成界面能用的形状：去掉多余空白，冠词落在允许的值上，分类落在已知分类里。整理不出就当不确定，不编一个词。

例子：模型给了瑞典语但没给冠词。卡片上的冠词为空，界面仍可保存，朗读时按有没有冠词来读。
