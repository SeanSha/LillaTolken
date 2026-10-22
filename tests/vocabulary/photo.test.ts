import { describe, expect, it } from 'vitest';
import { cacheCardAudio, createMemoryVocabularyLibrary, saveNewCard, type VocabularyLibrary } from '../../apps/web/src/vocabulary/library';
import { replaceCardPhoto } from '../../apps/web/src/vocabulary/photo';

function image(byte: number): Blob {
  return new Blob([Uint8Array.from([byte])], { type: 'image/jpeg' });
}

async function saved() {
  const library = createMemoryVocabularyLibrary();
  const card = await saveNewCard(library, { image: image(1), thumb: image(1), imageHash: 'old-photo', zh: '汽车', sv: 'bil', article: 'en', category: 'vehicles' });
  const audio = new Blob([Uint8Array.from([9])], { type: 'audio/mpeg' });
  await cacheCardAudio(library, card.id, 'zh', audio);
  await cacheCardAudio(library, card.id, 'sv', audio);
  return { library, card, audio };
}

describe('photo replacement', () => {
  it('updates a local card without calling the network', async () => {
    const { library, card, audio } = await saved();
    const fetchImpl = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    const next = await replaceCardPhoto(library, card.id, { image: image(2), thumb: image(2), imageHash: 'new-photo' }, fetchImpl);
    expect(next.id).toBe(card.id);
    expect(next.zh).toBe('汽车');
    expect(next.sv).toBe('bil');
    expect(next.article).toBe('en');
    expect(next.category).toBe('vehicles');
    expect(next.imageHash).toBe('new-photo');
    expect(next.zhAudio).toBe(audio);
    expect(next.svAudio).toBe(audio);
  });

  it('keeps the old photo when the household update fails', async () => {
    const { library, card, audio } = await saved();
    await library.syncPut({ localId: card.id, remoteId: card.id, status: 'synced', detail: null });
    const urls: string[] = [];
    const fetchImpl = (async (path: string) => {
      urls.push(String(path));
      return new Response('no', { status: 500 });
    }) as typeof fetch;
    await expect(replaceCardPhoto(library, card.id, { image: image(3), thumb: image(3), imageHash: 'new-photo' }, fetchImpl)).rejects.toBeTruthy();
    const kept = await library.get(card.id);
    expect(kept?.imageHash).toBe('old-photo');
    expect(kept?.zhAudio).toBe(audio);
    expect(kept?.svAudio).toBe(audio);
    expect(urls).toEqual([`/api/vocabulary/cards/${card.id}/image`]);
    expect(urls.some((url) => url.includes('identify') || url.includes('/api/tts'))).toBe(false);
  });

  it('puts the old household photo back when the local write fails', async () => {
    const { library, card } = await saved();
    await library.syncPut({ localId: card.id, remoteId: 'remote-1', status: 'synced', detail: null });
    const bodies: string[] = [];
    const fetchImpl = (async (_path: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ card: { id: 'remote-1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const failing: VocabularyLibrary = {
      ...library,
      async replaceImage() {
        throw new Error('disk');
      },
    };
    await expect(replaceCardPhoto(failing, card.id, { image: image(4), thumb: image(4), imageHash: 'new-photo' }, fetchImpl)).rejects.toThrow('disk');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('new-photo');
    expect(bodies[1]).toContain('old-photo');
    expect((await library.get(card.id))?.imageHash).toBe('old-photo');
    expect((await library.syncGet(card.id))?.status).toBe('synced');
  });
});
