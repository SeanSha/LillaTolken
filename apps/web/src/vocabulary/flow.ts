import type { VocabularyCandidate, VocabularyCategoryId, VocabularyIdentifyResponse } from '@kt/shared';

export type Draft = {
  zh: string;
  sv: string;
  article: VocabularyCandidate['article'];
  translationUncertain: boolean;
  category: VocabularyCategoryId;
};

export type IdentifyStep =
  | { kind: 'blocked'; outcome: 'person' | 'none' }
  | { kind: 'choose'; candidates: VocabularyCandidate[] }
  | { kind: 'draft'; draft: Draft; banner: 'uncertain' | 'check' | null };

const EMPTY: Draft = { zh: '', sv: '', article: null, translationUncertain: true, category: 'other' };

/** One recognition at a time. A second tap before the first returns is refused. */
export function claimRecognition(lock: { current: boolean }): 'start' | 'blocked' {
  if (lock.current) return 'blocked';
  lock.current = true;
  return 'start';
}

export function releaseRecognition(lock: { current: boolean }): void {
  lock.current = false;
}

/** What the screen does with an identify result. Uncertain never arrives with a guessed word. */
export function stepAfterIdentify(result: VocabularyIdentifyResponse): IdentifyStep {
  if (result.outcome === 'person' || result.outcome === 'none') return { kind: 'blocked', outcome: result.outcome };
  if (result.outcome === 'uncertain' || result.candidates.length === 0) return { kind: 'draft', draft: { ...EMPTY }, banner: 'uncertain' };
  if (result.outcome === 'multiple') return { kind: 'choose', candidates: result.candidates };
  const candidate = result.candidates[0];
  if (!candidate) return { kind: 'draft', draft: { ...EMPTY }, banner: 'uncertain' };
  return {
    kind: 'draft',
    draft: { zh: candidate.zh, sv: candidate.sv, article: candidate.article, translationUncertain: candidate.translationUncertain, category: candidate.category },
    banner: candidate.translationUncertain ? 'check' : null,
  };
}
