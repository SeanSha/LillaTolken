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

  it('replaces only the photo and drops audio only when that language changes', async () => {
    const { library, card } = await save('photo-a');
    const audio = new Blob([Uint8Array.from([9])], { type: 'audio/mpeg' });
    await cacheCardAudio(library, card.id, 'zh', audio);
    await cacheCardAudio(library, card.id, 'sv', audio);

    const replaced = await library.replaceImage(card.id, { image: image(8), thumb: image(7), imageHash: 'photo-b' });
    expect(replaced.id).toBe(card.id);
    expect(replaced.zh).toBe('苹果');
    expect(replaced.sv).toBe('äpple');
    expect(replaced.article).toBe('ett');
    expect(replaced.imageHash).toBe('photo-b');
    expect(replaced.zhAudio).toBe(audio);
    expect(replaced.svAudio).toBe(audio);
    expect(replaced.createdAt).toBe(card.createdAt);
    expect(await library.findByHash('photo-a')).toBeNull();
    expect((await library.findByHash('photo-b'))?.id).toBe(card.id);

    const swedishOnly = await library.update(card.id, { article: 'en' });
    expect(swedishOnly.zhAudio).toBe(audio);
    expect(swedishOnly.svAudio).toBeNull();
    expect(swedishOnly.article).toBe('en');

    const categoryOnly = await library.update(card.id, { category: 'food', categorySource: 'manual' });
    expect(categoryOnly.zhAudio).toBe(audio);
    expect(categoryOnly.categorySource).toBe('manual');

    await expect(library.replaceImage(card.id, { image: image(2), thumb: null, imageHash: 'other-photo' })).resolves.toMatchObject({ id: card.id });
    const other = await saveNewCard(library, { image: image(3), imageHash: 'taken', zh: '杯子', sv: 'mugg', article: 'en' });
    await expect(library.replaceImage(card.id, { image: image(3), thumb: null, imageHash: 'taken' })).rejects.toMatchObject({ existingId: other.id });
    expect((await library.get(card.id))?.imageHash).not.toBe('taken');
    expect((await library.get(card.id))?.zhAudio).toBe(audio);
  });
});
