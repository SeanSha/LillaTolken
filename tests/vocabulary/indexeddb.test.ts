import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheCardAudio, createIndexedDbVocabularyLibrary, saveNewCard } from '../../apps/web/src/vocabulary/library';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('kt-vocabulary');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('indexedDB delete blocked'));
  });
});

describe('IndexedDB vocabulary cards', () => {
  it('reloads the card, the thumbnail, and cached audio from a new connection', async () => {
    const first = createIndexedDbVocabularyLibrary();
    const image = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/jpeg' });
    const card = await saveNewCard(first, { image, imageHash: 'photo-1', zh: '苹果', sv: 'äpple', article: 'ett' });
    const swedish = new Blob([Uint8Array.from([9, 9])], { type: 'audio/mpeg' });
    await cacheCardAudio(first, card.id, 'sv', swedish);

    const second = createIndexedDbVocabularyLibrary();
    const loaded = await second.get(card.id);
    expect(loaded?.zh).toBe('苹果');
    expect(loaded?.sv).toBe('äpple');
    expect(loaded?.article).toBe('ett');
    expect(loaded?.image.type).toBe('image/jpeg');
    expect(new Uint8Array(await loaded!.image.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(new Uint8Array(await loaded!.svAudio!.arrayBuffer())).toEqual(Uint8Array.from([9, 9]));

    await second.remove(card.id);
    const third = createIndexedDbVocabularyLibrary();
    expect(await third.list()).toEqual([]);
    await first.close();
    await second.close();
    await third.close();
  });

  it('keeps a card that was saved before the sync store existed', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('kt-vocabulary', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore('cards', { keyPath: 'id' });
        store.createIndex('imageHash', 'imageHash', { unique: true });
        store.createIndex('createdAt', 'createdAt');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('cards', 'readwrite');
        tx.objectStore('cards').add({
          id: 'old-1',
          createdAt: 10,
          imageHash: 'old-photo',
          zh: '杯子',
          sv: 'mugg',
          article: 'en',
          image: new Blob([Uint8Array.from([7])], { type: 'image/jpeg' }),
          zhAudio: null,
          svAudio: null,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });

    const library = createIndexedDbVocabularyLibrary();
    const rows = await library.list();
    expect(rows.map((row) => row.zh)).toEqual(['杯子']);
    expect(rows[0]?.category).toBeUndefined();
    const summaries = await library.listSummaries();
    expect(summaries.map((row) => row.zh)).toEqual(['杯子']);
    await library.close();
  });

  it('replaces the photo in place and reloads the cached audio', async () => {
    const first = createIndexedDbVocabularyLibrary();
    const image = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/jpeg' });
    const card = await saveNewCard(first, { image, thumb: image, imageHash: 'photo-1', zh: '汽车', sv: 'bil', article: 'en' });
    const audio = new Blob([Uint8Array.from([5])], { type: 'audio/mpeg' });
    await cacheCardAudio(first, card.id, 'zh', audio);
    await cacheCardAudio(first, card.id, 'sv', audio);
    const nextImage = new Blob([Uint8Array.from([8, 8])], { type: 'image/jpeg' });
    await first.replaceImage(card.id, { image: nextImage, thumb: nextImage, imageHash: 'photo-2' });
    await first.close();

    const second = createIndexedDbVocabularyLibrary();
    const loaded = await second.get(card.id);
    expect(loaded?.imageHash).toBe('photo-2');
    expect(loaded?.zh).toBe('汽车');
    expect(loaded?.article).toBe('en');
    expect(new Uint8Array(await loaded!.image.arrayBuffer())).toEqual(Uint8Array.from([8, 8]));
    expect(new Uint8Array(await loaded!.zhAudio!.arrayBuffer())).toEqual(Uint8Array.from([5]));
    expect(new Uint8Array(await loaded!.svAudio!.arrayBuffer())).toEqual(Uint8Array.from([5]));
    expect(await second.findByHash('photo-1')).toBeNull();
    await second.close();
  });
});
