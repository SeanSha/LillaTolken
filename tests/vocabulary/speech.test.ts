import { describe, expect, it } from 'vitest';
import { AppError } from '@kt/shared';
import { identifyImage } from '../../apps/web/src/vocabulary/api';
import { claimRecognition, releaseRecognition, stepAfterIdentify } from '../../apps/web/src/vocabulary/flow';
import { canSaveDraft, labelForSpeech, synthesizeLabel } from '../../apps/web/src/vocabulary/speech';

describe('vocabulary speech and identify client', () => {
  it('speaks Chinese and Swedish on separate calls, with en/ett in the Swedish line', async () => {
    const draft = { zh: '苹果', sv: 'äpple', article: 'ett' as const };
    expect(labelForSpeech(draft, 'zh')).toEqual({ text: '苹果', language: 'zh' });
    expect(labelForSpeech(draft, 'sv')).toEqual({ text: 'ett äpple', language: 'sv' });
    expect(labelForSpeech({ zh: '水', sv: 'vatten', article: null }, 'sv')?.text).toBe('vatten');

    const seen: Array<{ text: string; language: string; preset: string | null }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as { text: string; language: string };
      seen.push({ text: body.text, language: body.language, preset: headers['X-Provider-Preset'] ?? null });
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;

    await synthesizeLabel(draft, 'sv', { fetchImpl, cardId: '11111111-1111-4111-8111-111111111111' });
    await synthesizeLabel(draft, 'zh', { fetchImpl, cardId: '11111111-1111-4111-8111-111111111111' });
    expect(seen).toEqual([
      { text: 'ett äpple', language: 'sv', preset: 'cloud' },
      { text: '苹果', language: 'zh', preset: 'cloud' },
    ]);
    const headers = [] as Array<Record<string, string>>;
    const headed = (async (_url: string, init?: RequestInit) => {
      headers.push(init?.headers as Record<string, string>);
      return new Response(Uint8Array.from([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    await synthesizeLabel(draft, 'sv', { fetchImpl: headed, cardId: '11111111-1111-4111-8111-111111111111' });
    await synthesizeLabel(draft, 'zh', { fetchImpl: headed, cardId: '11111111-1111-4111-8111-111111111111' });
    expect(headers[0]?.['X-Feature']).toBe('vocabulary');
    expect(headers[0]?.['X-Card-Id']).toBe('11111111-1111-4111-8111-111111111111');
    expect(headers[0]?.['X-Task-Id']).toBe(headers[1]?.['X-Task-Id']);
    expect(headers[0]?.['X-Request-Id']).not.toBe(headers[1]?.['X-Request-Id']);

    const localHeaders: Array<Record<string, string>> = [];
    const localFetch = (async (_url: string, init?: RequestInit) => {
      localHeaders.push(init?.headers as Record<string, string>);
      return new Response(Uint8Array.from([1]), { status: 200, headers: { 'content-type': 'audio/wav' } });
    }) as typeof fetch;
    await synthesizeLabel(draft, 'zh', { fetchImpl: localFetch, cardId: '11111111-1111-4111-8111-111111111111', preset: 'local' });
    await synthesizeLabel(draft, 'sv', { fetchImpl: localFetch, cardId: '11111111-1111-4111-8111-111111111111', preset: 'mock' });
    expect(localHeaders[0]?.['X-Provider-Preset']).toBe('local');
    expect(localHeaders[1]?.['X-Provider-Preset']).toBe('cloud');
  });

  it('lets the first recognition through and blocks a second tap until it finishes', () => {
    const lock = { current: false };
    expect(claimRecognition(lock)).toBe('start');
    expect(claimRecognition(lock)).toBe('blocked');
    expect(lock.current).toBe(true);
    releaseRecognition(lock);
    expect(claimRecognition(lock)).toBe('start');
  });

  it('refuses to save an empty correction and does not invent a word for an uncertain photo', () => {
    expect(canSaveDraft({ zh: '', sv: 'äpple' })).toBe(false);
    expect(canSaveDraft({ zh: '苹果', sv: 'äpple' })).toBe(true);
    const step = stepAfterIdentify({ outcome: 'uncertain', candidates: [] });
    expect(step.kind === 'draft' && step.draft.zh === '' && step.draft.sv === '').toBe(true);
    expect(stepAfterIdentify({ outcome: 'person', candidates: [] })).toEqual({ kind: 'blocked', outcome: 'person' });
    const food = stepAfterIdentify({
      outcome: 'object',
      candidates: [{ zh: '苹果', sv: 'äpple', article: 'ett', translationUncertain: false, category: 'food' }],
    });
    expect(food.kind === 'draft' && food.draft.category === 'food').toBe(true);
  });

  it('maps identify failures without showing a raw upstream body', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['X-Provider-Preset']).toBe('local');
      return new Response(JSON.stringify({ error: { category: 'NOT_CONFIGURED' } }), { status: 501 });
    }) as typeof fetch;
    await expect(identifyImage(Uint8Array.from([1]), 'image/jpeg', { fetchImpl, preset: 'local' })).rejects.toMatchObject({ category: 'NOT_CONFIGURED' });

    const broken = (async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    await expect(identifyImage(Uint8Array.from([1]), 'image/jpeg', { fetchImpl: broken })).rejects.toBeInstanceOf(AppError);

    const down = (async () => {
      throw new Error('socket');
    }) as typeof fetch;
    await expect(identifyImage(Uint8Array.from([1]), 'image/jpeg', { fetchImpl: down })).rejects.toMatchObject({ category: 'NETWORK' });
  });
});
