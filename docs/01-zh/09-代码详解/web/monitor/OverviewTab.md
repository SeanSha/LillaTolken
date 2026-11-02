# `apps/web/src/monitor/OverviewTab.tsx`

源码：[OverviewTab.tsx](../../../../../apps/web/src/monitor/OverviewTab.tsx)

打开监控首先看到的一页：任务数、成功率、延迟、按阶段和预设的对比、本机引擎是否就绪。

样本很少时，p95 只是描述，不要把它当成很精确的指标。健康面板显示 whisper、Ollama、语音的状态，以及 cloud 有没有配置。不显示密钥，也不会为了探活去打一次会花钱的云端调用。

例子：local 引擎没开。健康面板给出不可用原因。同一页上的 cloud 请求数不应因为这次查看而增加。
