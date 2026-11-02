# `apps/server/src/providers/cloud/prompts.ts`

源码：[prompts.ts](../../../../../../apps/server/src/providers/cloud/prompts.ts)

发给云端模型的系统提示和输出格式。版本常量是 `p3`。

`INTERPRET_SYSTEM_PROMPT` 要求理解结果只能是追问、提出意思或无法判断。`TRANSLATE_ZH_TO_SV_PROMPT` 和 `TRANSLATE_SV_TO_ZH_PROMPT` 分别管两个方向。`TTS_READ_EXACTLY` 要求朗读只读给定文本，不要闲聊。

例子：模型如果想多问一句无关的话，JSON schema 不接受自由发挥的第四种结果。状态机仍会再检查次数。

研究说明里的固定链接指向某一次提交上的这份文件。当前工作区的这份以后可能会改。
