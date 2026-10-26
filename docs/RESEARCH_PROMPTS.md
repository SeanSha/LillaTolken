# Research prompt and structured-output reference

This note accompanies the exploratory evaluation described in
*Design and Evaluation of a Dialogue-Based Speech Translator for Children: An Empirical Study*.

## Versioned source

The paper's former Appendix G (prompt instructions and output schemas)
is available directly as the source file below, instead of being duplicated
in the paper:

- **[Prompt revision p3 — pinned source at commit `107a3d7`](https://github.com/SeanSha/LillaTolken/blob/107a3d7/apps/server/src/providers/cloud/prompts.ts)**
- [Current implementation (may change)](../apps/server/src/providers/cloud/prompts.ts)

The pinned source includes:
- Chinese speech interpretation: `INTERPRET_SYSTEM_PROMPT`
- Structured interpretation outcomes and schema: `INTERPRET_JSON_SCHEMA`
- Chinese-to-Swedish and Swedish-to-Chinese translation instructions
- Translation output schema: `TRANSLATE_JSON_SCHEMA`
- Cloud speech synthesis instructions: `TTS_READ_EXACTLY` and `TTS_INSTRUCTIONS`

## Dialogue-policy interaction

The language model returns a structured interpretation or translation.
The application validates the output and uses XState to decide the next
permitted step. Interpretation may return one of three decisions:
`PROPOSE_MEANING`, `ASK_CLARIFICATION`, or `UNRESOLVED`.
The controller, not a free-form LLM response, manages the clarification,
correction, confirmation, direction switch, and delivery flow.

The prompt receives runtime dialogue context separately (e.g.
`dialogueInputs`, `remainingClarifications`, and `previousDelivered`).
The pinned file documents fixed prompt instructions and schemas; it is not
a transcript of test sessions.

## Scope and reproducibility note

The research record labels the interpretation prompt as revision **p3**.
The pinned source above reproduces that revision and is suitable for readers
to inspect. However, the evaluation materials did not preserve a complete
tested commit identifier or all third-party Voice session settings.
Consequently the source commit should **not** be described as a verified,
complete snapshot of the exact experimental runtime.

This page contains no participant speech recordings, children's personal
information, secrets, or API keys.