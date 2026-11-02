# `apps/web/src/vocabulary/VocabularyShell.tsx`

源码：[VocabularyShell.tsx](../../../../../apps/web/src/vocabulary/VocabularyShell.tsx)

词卡的整页：拍照、预览、确认、格子和学习页。`App.tsx` 在 `feature` 是 `photo` 或 `library` 时才画它。

它按 `flow.ts` 的结果切换这些小画面，不向对话状态机 `send` 事件。

例子：从首页进来拍照。预览上点「认一认」。成功后看到中文、带冠词的瑞典语，以及两个分开的播放按钮。声音只在点击后播放。保存后进入大图学习页。

按住标题旁的小圆点大约两秒，才打开家长页。短按打不开。家长页里才有家庭口令、同步和删除。
