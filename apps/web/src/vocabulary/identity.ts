import { swedishWithArticle, type SwedishArticle } from '@kt/shared';
import type { VocabularyCard, VocabularyLibrary } from './library';

const EDGE_PUNCT = /[\s.,!?;:，。！？、·"'“”「」]+/g;

export type WordIdentity = {
  zh: string;
  sv: string;
  article: SwedishArticle | null;
};

/** Everyday Chinese noun. Whitespace and surrounding punctuation are not part of the word. */
export function normalizeChinese(zh: string): string {
  return zh.normalize('NFC').replace(EDGE_PUNCT, '').toLocaleLowerCase('zh-CN');
}

/**
 * Swedish noun plus the article that belongs to it.
 * A leading "en"/"ett" in the label counts only when it does not contradict the stored article.
 * Two different articles stay different: "en bok" (book) is not "ett bok" (beech).
 */
export function swedishParts(sv: string, article: SwedishArticle | null): { article: SwedishArticle | null; noun: string } {
  const text = sv.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/^[\s.,!?;:，。！？、·]+|[\s.,!?;:，。！？、·]+$/g, '').toLocaleLowerCase('sv-SE');
  const embedded = /^(en|ett)\s+(.+)$/.exec(text);
  if (!embedded) return { article, noun: text };
  const leading = embedded[1] as SwedishArticle;
  const noun = embedded[2].trim();
  if (!noun || (article && article !== leading)) return { article, noun: text };
  return { article: article ?? leading, noun };
}

/** True when both languages name the same card. One language is never enough. */
export function sameVocabulary(a: WordIdentity, b: WordIdentity): boolean {
  const zhA = normalizeChinese(a.zh);
  const zhB = normalizeChinese(b.zh);
  if (!zhA || zhA !== zhB) return false;
  const svA = swedishParts(a.sv, a.article);
  const svB = swedishParts(b.sv, b.article);
  if (!svA.noun || svA.noun !== svB.noun) return false;
  if (svA.article && svB.article && svA.article !== svB.article) return false;
  return true;
}

/** Text that would be spoken. Photo changes do not affect this. */
export function spokenLabel(card: WordIdentity, language: 'zh' | 'sv'): string {
  if (language === 'zh') return card.zh.trim();
  return swedishWithArticle(card.article, card.sv);
}

/** Newest card with the same word, or null. Image hashes are not consulted. */
export async function findVocabularyMatch(library: VocabularyLibrary, word: WordIdentity): Promise<VocabularyCard | null> {
  const rows = await library.listSummaries();
  const hit = rows.find((row) => sameVocabulary(row, word));
  return hit ? library.get(hit.id) : null;
}
