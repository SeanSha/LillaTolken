import type { ProviderPreset, VocabActionKind } from '@kt/shared';

/** Tells the dashboard what happened. Failures are ignored. No words or photos are sent. */
export function reportVocabAction(kind: VocabActionKind, preset: ProviderPreset, cardId?: string | null, fetchImpl: typeof fetch = fetch): void {
  void fetchImpl('/api/vocabulary/actions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, preset, cardId: cardId ?? null }),
  }).catch(() => undefined);
}
