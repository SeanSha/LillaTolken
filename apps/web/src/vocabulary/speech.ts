import { swedishWithArticle, VOCABULARY_LIMITS, type ProviderPreset, type SwedishArticle } from '@kt/shared';
import { createApiBundle } from '../services/apiClient';

type FetchLike = typeof fetch;

export function labelForSpeech(
  draft: { zh: string; sv: string; article: SwedishArticle | null },
  language: 'zh' | 'sv',
): { text: string; language: 'zh' | 'sv' } | null {
  if (language === 'zh') {
    const text = draft.zh.trim();
    return text ? { text, language: 'zh' } : null;
  }
  const text = swedishWithArticle(draft.article, draft.sv);
  return text ? { text, language: 'sv' } : null;
}

export function canSaveDraft(draft: { zh: string; sv: string }): boolean {
  const zh = draft.zh.trim();
  const sv = draft.sv.trim();
  if (!zh || !sv) return false;
  if (zh.length > VOCABULARY_LIMITS.maxLabelChars || sv.length > VOCABULARY_LIMITS.maxLabelChars) return false;
  if (hasControl(zh) || hasControl(sv)) return false;
  return true;
}

function hasControl(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 32) return true;
  }
  return false;
}

/**
 * Reuses POST /api/tts. Local preset uses macOS say. Cloud and mock keep the cloud voice,
 * including the Swedish article in the spoken line.
 * Playback itself is started by the button handler, never from this function.
 */
export async function synthesizeLabel(
  draft: { zh: string; sv: string; article: SwedishArticle | null },
  language: 'zh' | 'sv',
  options: { fetchImpl?: FetchLike; cardId?: string; preset?: ProviderPreset } = {},
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const line = labelForSpeech(draft, language);
  if (!line) throw new Error('EMPTY_LABEL');
  const cardId = options.cardId && /^[A-Za-z0-9_.:-]{1,80}$/.test(options.cardId) ? options.cardId : crypto.randomUUID();
  const preset = options.preset === 'local' ? 'local' : 'cloud';
  const bundle = createApiBundle(preset, { fetchImpl: options.fetchImpl, timeoutMs: 45_000 });
  const audio = await bundle.tts.synthesize(line.text, line.language, {
    taskId: `vocab.${cardId}`,
    requestId: `vocab.${crypto.randomUUID()}`,
    feature: 'vocabulary',
    cardId,
  });
  return { bytes: audio.bytes, mimeType: audio.mimeType };
}
