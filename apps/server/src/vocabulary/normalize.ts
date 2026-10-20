// Turns a vision model's structured guess into a card the UI is allowed to show.
// Uncertain, empty, or person results never keep a made-up label.
import { AppError, VOCABULARY_LIMITS, VocabularyIdentifyResponseSchema, vocabularyCategory, type SwedishArticle, type VocabularyCandidate, type VocabularyIdentifyResponse, type VocabularyOutcome } from '@kt/shared';
import { z } from 'zod';

const RawCandidateSchema = z.object({
  zh: z.string().max(200),
  sv: z.string().max(200),
  article: z.enum(['en', 'ett', 'none']),
  translationUncertain: z.boolean(),
  category: z.string().optional(),
});

const RawIdentifySchema = z.object({
  outcome: z.enum(['object', 'multiple', 'uncertain', 'person', 'none']),
  candidates: z.array(RawCandidateSchema).max(8),
});

/** Whole-label backstop. The prompt already forbids naming people; this drops it if a model does anyway. */
const PERSON_LABEL =
  /^(一个人|人物|人|人脸|面孔|小孩|孩子|儿童|男孩|女孩|男人|女人|男士|女士|婴儿|宝宝|人像|person|people|human|child|baby|man|woman|boy|girl|kid|face|personer|människa|människor|barn|bebis|pojke|flicka|kvinna|ansikte)$/i;

function isPersonLabel(zh: string, sv: string): boolean {
  return PERSON_LABEL.test(zh) || PERSON_LABEL.test(sv);
}

function hasControl(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 32) return true;
  }
  return false;
}

function usableCandidate(raw: z.infer<typeof RawCandidateSchema>): VocabularyCandidate | 'person' | null {
  const zh = raw.zh.trim();
  const sv = raw.sv.trim();
  if (!zh && !sv) return null;
  if (isPersonLabel(zh, sv)) return 'person';
  // A missing language is uncertainty, not an invitation to fill the blank.
  if (!zh || !sv) return null;
  if (zh.length > VOCABULARY_LIMITS.maxLabelChars || sv.length > VOCABULARY_LIMITS.maxLabelChars) return null;
  if (hasControl(zh) || hasControl(sv)) return null;
  if (!/\p{L}/u.test(zh) || !/\p{L}/u.test(sv)) return null;
  const article: SwedishArticle | null = raw.article === 'none' ? null : raw.article;
  return { zh, sv, article, translationUncertain: raw.translationUncertain, category: vocabularyCategory(raw.category).id };
}

function finish(outcome: VocabularyOutcome, candidates: VocabularyCandidate[]): VocabularyIdentifyResponse {
  const parsed = VocabularyIdentifyResponseSchema.safeParse({ outcome, candidates });
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
  const count = parsed.data.candidates.length;
  if ((outcome === 'uncertain' || outcome === 'person' || outcome === 'none') && count !== 0) {
    throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
  }
  if (outcome === 'object' && count !== 1) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
  if (outcome === 'multiple' && count < 2) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
  return parsed.data;
}

/**
 * Accepts the model's JSON object (already parsed).
 * `uncertain`, `person`, and `none` always return an empty candidate list.
 */
export function normalizeVocabularyModelOutput(raw: unknown): VocabularyIdentifyResponse {
  const parsed = RawIdentifySchema.safeParse(raw);
  if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
  if (parsed.data.outcome === 'person') return finish('person', []);
  if (parsed.data.outcome === 'none') return finish('none', []);
  if (parsed.data.outcome === 'uncertain') return finish('uncertain', []);

  const cleaned: VocabularyCandidate[] = [];
  let sawPerson = false;
  for (const rawCandidate of parsed.data.candidates) {
    const candidate = usableCandidate(rawCandidate);
    if (candidate === 'person') {
      sawPerson = true;
      continue;
    }
    if (candidate) cleaned.push(candidate);
  }
  const candidates = cleaned.slice(0, VOCABULARY_LIMITS.maxCandidates);
  if (candidates.length === 0) return finish(sawPerson ? 'person' : 'uncertain', []);
  if (candidates.length === 1) return finish('object', candidates);
  return finish('multiple', candidates);
}
