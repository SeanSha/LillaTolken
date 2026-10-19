// Provider-independent validation of LLM output (docs/SYSTEM_DESIGN.md 5: "Validate JSON and
// schema from any LLM before dispatching XState events"). Cloud and Local share this code so the
// SAME Zod schema and the SAME server-side policy cap apply to every model.
import {
  AppError,
  InterpretationResultSchema,
  TranslateResponseSchema,
  type InterpretationResult,
} from '@kt/shared';

export function parseJson(raw: string | null | undefined): unknown {
  if (!raw) throw new AppError('INVALID_MODEL_OUTPUT', 'empty model output');
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_MODEL_OUTPUT', 'model output is not valid JSON');
  }
}

/** Validates the model's interpretation and re-enforces the clarification budget. */
export function parseInterpretation(raw: unknown, remainingClarifications: number): InterpretationResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('INVALID_MODEL_OUTPUT', 'model output is not an object');
  }
  const r = raw as Record<string, unknown>;
  const candidate =
    r.kind === 'ASK_CLARIFICATION'
      ? { kind: 'ASK_CLARIFICATION', questionZh: r.questionZh, reasonCode: r.reasonCode ?? '' }
      : r.kind === 'PROPOSE_MEANING'
        ? { kind: 'PROPOSE_MEANING', meaningZh: r.meaningZh }
        : r.kind === 'UNRESOLVED'
          ? { kind: 'UNRESOLVED', reasonCode: r.reasonCode ?? '' }
          : null;
  const parsed = InterpretationResultSchema.safeParse(candidate);
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'interpretation failed schema validation');
  // Policy is enforced again here: a model cannot ask when the budget is gone.
  if (parsed.data.kind === 'ASK_CLARIFICATION' && remainingClarifications <= 0) {
    return { kind: 'UNRESOLVED', reasonCode: 'CLARIFICATION_BUDGET_EXHAUSTED' };
  }
  return parsed.data;
}

export function parseTranslation(raw: unknown): string {
  const parsed = TranslateResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'translation failed schema validation');
  return parsed.data.translation;
}
