# Start here

Series: [01 System design](../01-system-design.md) · [02 Developer guide](../02-developer-guide.md) · [03 UI brief](../03-ui-brief.md) · [04 Tab5 feasibility](../04-tab5-feasibility.md) · [05 Code guide](../05-code-guide.md) · [06 Research prompts](../06-research-prompts.md) · [07 Module structure](../07-module-structure.md) · [08 How the modules fit](../08-how-modules-fit.md) · **09 Code walkthrough**

The Chinese file is in [`docs/01-zh`](../../01-zh/09-代码详解/00-从这里开始.md).

The nine documents each do one job. Follow the numbers.

1. [01 System design](../01-system-design.md): the product rules and the whole dialogue.
2. [02 Developer guide](../02-developer-guide.md): how to run the program.
3. [03 UI brief](../03-ui-brief.md): screens and buttons, for design.
4. [04 Tab5 feasibility](../04-tab5-feasibility.md): whether it can move onto that hardware.
5. [05 Code guide](../05-code-guide.md): the three parts of the code, and a file map.
6. [06 Research prompts](../06-research-prompts.md): the prompts used in the paper.
7. [07 Module structure](../07-module-structure.md): what each module does, with shortened code.
8. [08 How the modules fit](../08-how-modules-fit.md): what one turn passes across the boundaries.
9. This document: follow a feature first, then open a file.

## How to read this document

Two paths. Finish one before switching.

- **By feature.** Open [By feature](features/00-by-feature.md) and read item 1 through item 9. Inside every page the order is the same: the snapshot JSON, the call sequence, then the steps.
- **By file.** The paragraph-by-paragraph notes for each source file are in the [Chinese index](../../01-zh/09-代码详解/00-从这里开始.md), under the same folder names (`web/`, `server/`, `shared/`). The state machine page is also in English, in four sections: the JSON, who calls whom, which event writes which fields, then each stage. See [machine.ts](web/dialogue/machine.md).

Read the sentence and the three paths below before opening every file.

## One sentence

The child presses “speak Chinese”. The page only hands that action to the state machine. The machine decides the next step: record, recognize, interpret, confirm, translate, speak. The server is what calls a model. The server has three interchangeable implementations: fake `mock`, cloud `cloud`, and `local` on this Mac.

Example: the child wants to say 「我想去厕所。」

1. The home button sends `START_TASK`, direction `ZH_TO_SV`.
2. The machine enters recording. Under mock, nobody has to speak. Stopping yields the scripted line.
3. They tap Finished. Recognition returns the text 「我想去厕所。」
4. Because this is Chinese, the machine interprets. The meaning is clear, so the model returns a proposed meaning.
5. The page asks 「你是说：我想去厕所，对吗？」 The child taps yes.
6. Only then does it translate, and then speak Swedish.

Nothing is translated before yes. If the line is vague, such as 「他拿走了我的那个」, the model may ask a question. The machine allows at most 3.

## Three paths, each with its own memory

- **Spoken translation.** Owned by `apps/web/src/dialogue/machine.ts`.
- **Photo cards.** `App.tsx` switches `feature`. That does not enter the machine.
- **Monitor.** The address is `/monitor`. It records timing and cost, not what the child said.
