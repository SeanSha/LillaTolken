// Photo vocabulary cards. Independent of the dialogue translator contracts.
import { z } from 'zod';

export const VOCABULARY_LIMITS = {
  /** Compressed image accepted by the identify route. The browser downscales before upload. */
  maxImageBytes: 1_500_000,
  maxLabelChars: 40,
  maxCandidates: 4,
} as const;

export type SwedishArticle = 'en' | 'ett';
export type VocabularyOutcome = 'object' | 'multiple' | 'uncertain' | 'person' | 'none';

export const VocabularyCandidateSchema = z
  .object({
    zh: z.string().trim().min(1).max(VOCABULARY_LIMITS.maxLabelChars),
    sv: z.string().trim().min(1).max(VOCABULARY_LIMITS.maxLabelChars),
    article: z.enum(['en', 'ett']).nullable(),
    translationUncertain: z.boolean(),
    category: z.string().optional(),
  })
  .transform((value) => ({
    zh: value.zh,
    sv: value.sv,
    article: value.article,
    translationUncertain: value.translationUncertain,
    category: vocabularyCategory(value.category).id,
  }));

export type VocabularyCandidate = z.infer<typeof VocabularyCandidateSchema>;

/** Safe identify result. Uncertain / person / none never carry a guessed label. */
export const VocabularyIdentifyResponseSchema = z.object({
  outcome: z.enum(['object', 'multiple', 'uncertain', 'person', 'none']),
  candidates: z.array(VocabularyCandidateSchema).max(VOCABULARY_LIMITS.maxCandidates),
});

export type VocabularyIdentifyResponse = z.infer<typeof VocabularyIdentifyResponseSchema>;

/** Drops any label the model attached to a person, an empty scene, or an uncertain result. */
export function sanitizeVocabularyResponse(value: VocabularyIdentifyResponse): VocabularyIdentifyResponse {
  if (value.outcome === 'person' || value.outcome === 'none' || value.outcome === 'uncertain') {
    return { outcome: value.outcome, candidates: [] };
  }
  if (value.outcome === 'object') {
    return value.candidates.length === 1 ? value : { outcome: 'uncertain', candidates: [] };
  }
  if (value.candidates.length < 2) {
    return value.candidates.length === 1 ? { outcome: 'object', candidates: value.candidates } : { outcome: 'uncertain', candidates: [] };
  }
  return { outcome: 'multiple', candidates: value.candidates.slice(0, VOCABULARY_LIMITS.maxCandidates) };
}

export type ImageKind = 'jpeg' | 'png' | 'webp';

const MIME: Record<ImageKind, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Magic-byte sniff. The declared Content-Type is never trusted on its own. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export function mimeForImageKind(kind: ImageKind): 'image/jpeg' | 'image/png' | 'image/webp' {
  return MIME[kind];
}

export const VOCABULARY_CATEGORIES = [
  { id: 'animals', zh: '动物', sv: 'Djur' },
  { id: 'food', zh: '食物和饮料', sv: 'Mat och dryck' },
  { id: 'toys', zh: '玩具', sv: 'Leksaker' },
  { id: 'clothing', zh: '衣服', sv: 'Kläder' },
  { id: 'home', zh: '家居', sv: 'Hemma' },
  { id: 'school', zh: '学校', sv: 'Skolan' },
  { id: 'nature', zh: '自然', sv: 'Naturen' },
  { id: 'vehicles', zh: '交通工具', sv: 'Fordon' },
  { id: 'other', zh: '其他', sv: 'Annat' },
] as const;

export type VocabularyCategoryId = (typeof VOCABULARY_CATEGORIES)[number]['id'];

export function vocabularyCategory(id: string | null | undefined): (typeof VOCABULARY_CATEGORIES)[number] {
  return VOCABULARY_CATEGORIES.find((item) => item.id === id) ?? VOCABULARY_CATEGORIES[VOCABULARY_CATEGORIES.length - 1]!;
}

/** Swedish noun as spoken: the article is part of the word, when the noun has one. */
export function swedishWithArticle(article: SwedishArticle | null, sv: string): string {
  const word = sv.trim();
  return article ? `${article} ${word}` : word;
}

/**
 * Photo-vocabulary actions that are not model calls.
 * Token totals stay on the identify and speech rows. These counts are separate.
 */
export const VOCAB_ACTIONS = [
  'duplicate_detected',
  'keep_existing_photo',
  'replace_after_duplicate',
  'direct_replace',
  'exact_image_reuse',
  'prevented_duplicate_request',
  'card_created',
] as const;

export type VocabActionKind = (typeof VOCAB_ACTIONS)[number];
