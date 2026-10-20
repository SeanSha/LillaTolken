import { describe, expect, it } from 'vitest';
import { DuplicateCardError, cacheCardAudio, createMemoryVocabularyLibrary, saveNewCard, type VocabularyCard } from '../../apps/web/src/vocabulary/library';

function image(byte: number): Blob {
  return new Blob([Uint8Array.from([byte, byte, byte])], { type: 'image/jpeg' });
}

async function save(hash: string, zh = '苹果'): Promise<{ library: ReturnType<typeof createMemoryVocabularyLibrary>; card: VocabularyCard }> {
  const library = createMemoryVocabularyLibrary();
  const card = await saveNewCard(library, { image: image(1), imageHash: hash, zh, sv: 'äpple', article: 'ett' });
  return { library, card };
}

describe('vocabulary library', () => {
  it('keeps a card, its audio, and then deletes it', async () => {
    const { library, card } = await save('hash-a');
    const again = createMemoryVocabularyLibrary();
    expect(await again.list()).toEqual([]);

    const listed = await library.list();
    expect(listed.map((row) => row.zh)).toEqual(['苹果']);
    const audio = new Blob([Uint8Array.from([9])], { type: 'audio/mpeg' });
    const withZh = await cacheCardAudio(library, card.id, 'zh', audio);
    const withSv = await cacheCardAudio(library, card.id, 'sv', audio);
    expect(withZh.zhAudio).toBe(audio);
    expect(withSv.svAudio).toBe(audio);
    expect((await library.get(card.id))?.svAudio).toBe(audio);

    await library.remove(card.id);
    expect(await library.list()).toEqual([]);
    expect(await library.get(card.id)).toBeNull();
  });

  it('refuses a second save of the same photo and an empty label', async () => {
    const { library, card } = await save('same-photo');
    await expect(saveNewCard(library, { image: image(1), imageHash: 'same-photo', zh: '苹果', sv: 'äpple', article: 'ett' })).rejects.toBeInstanceOf(DuplicateCardError);
    await expect(saveNewCard(library, { image: image(2), imageHash: 'same-photo', zh: '杯子', sv: 'mugg', article: 'en' })).rejects.toMatchObject({ existingId: card.id });
    const other = await saveNewCard(library, { image: image(2), imageHash: 'other-photo', zh: '杯子', sv: 'mugg', article: 'en' });
    expect(new Set((await library.list()).map((row) => row.id))).toEqual(new Set([other.id, card.id]));
    await expect(saveNewCard(library, { image: image(3), imageHash: 'blank', zh: '  ', sv: 'äpple', article: 'ett' })).rejects.toThrow('INCOMPLETE_CARD');
  });
});
