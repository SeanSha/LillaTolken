import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VocabularyLibraryStore } from '../../apps/server/src/vocabulary/store';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function place(): { db: string; media: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-vocab-'));
  dirs.push(dir);
  return { db: path.join(dir, 'vocabulary.sqlite'), media: path.join(dir, 'media') };
}

function jpeg(mark: number): Buffer {
  const body = Buffer.alloc(48, mark);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  body[3] = 0xe0;
  return body;
}

function draft(mark: number, cardId = crypto.randomUUID(), createdAt = Date.UTC(2026, 0, 2, 3, 4, 5)) {
  const image = jpeg(mark);
  return {
    cardId,
    createdAt,
    imageHash: crypto.createHash('sha256').update(image).digest('hex'),
    zh: '苹果',
    sv: 'äpple',
    article: 'ett' as const,
    category: 'food' as const,
    image: new Uint8Array(image),
    thumb: new Uint8Array(jpeg(1)),
    zhAudio: null,
    svAudio: null,
  };
}

describe('household vocabulary store', () => {
  it('keeps image bytes out of sqlite, and a second save of the same card is the same row', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const owner = store.pair('family-code').ownerId;
    const input = draft(9);
    const first = store.save(owner, input);
    const second = store.save(owner, input);
    expect(first.status).toBe('saved');
    expect(second).toEqual({ status: 'exists', card: first.card });
    expect(store.list(owner, { sort: 'newest', limit: 10, offset: 0 }).total).toBe(1);
    expect(first.card.createdAt).toBe(input.createdAt);

    for (const file of [paths.db, `${paths.db}-wal`]) {
      if (!fs.existsSync(file)) continue;
      expect(fs.readFileSync(file).includes(Buffer.from(input.image))).toBe(false);
    }
    const media = store.mediaFile(owner, input.cardId, 'image');
    expect(media && fs.readFileSync(media.file).equals(Buffer.from(input.image))).toBe(true);
    store.close();
  });

  it('returns the existing card when the same photo is imported under another id', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const owner = store.pair('family-code').ownerId;
    const first = draft(4);
    const again = { ...draft(4, crypto.randomUUID()), image: first.image, imageHash: first.imageHash, thumb: first.thumb };
    store.save(owner, first);
    const existing = store.save(owner, again);
    expect(existing.status).toBe('exists');
    expect(existing.card.id).toBe(first.cardId);
    store.close();
  });

  it('does not let one household read another household card', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const a = store.pair('alpha-code');
    const b = store.pair('bravo-code');
    const saved = store.save(a.ownerId, draft(3));
    expect(store.get(b.ownerId, saved.card.id)).toBeNull();
    expect(store.list(b.ownerId, { sort: 'newest', limit: 10, offset: 0 }).total).toBe(0);
    expect(store.mediaFile(b.ownerId, saved.card.id, 'image')).toBeNull();
    store.close();
  });

  it('pages 500 cards without returning more than one page', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const owner = store.pair('family-code').ownerId;
    for (let i = 0; i < 500; i += 1) {
      const image = jpeg(i % 200);
      image[10] = i & 0xff;
      image[11] = (i >> 8) & 0xff;
      store.save(owner, {
        ...draft(1, crypto.randomUUID(), Date.UTC(2026, 0, 1) + i * 1000),
        image: new Uint8Array(image),
        imageHash: crypto.createHash('sha256').update(image).digest('hex'),
        zh: `词${i}`,
        sv: `ord${i}`,
        category: i % 2 === 0 ? 'animals' : 'food',
      });
    }
    const page = store.list(owner, { sort: 'newest', limit: 24, offset: 0 });
    expect(page.total).toBe(500);
    expect(page.cards).toHaveLength(24);
    const animals = store.list(owner, { sort: 'zh', limit: 24, offset: 0, category: 'animals', q: '词1' });
    expect(animals.total).toBeGreaterThan(0);
    expect(animals.cards.every((card) => card.category === 'animals' && card.zh.includes('词1'))).toBe(true);
    store.close();
  });

  it('leaves no card row when the photo is rejected', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const owner = store.pair('family-code').ownerId;
    const input = draft(2);
    expect(() => store.save(owner, { ...input, category: 'not-a-category' as 'food' })).toThrow(/category/);
    expect(store.list(owner, { sort: 'newest', limit: 10, offset: 0 }).total).toBe(0);
    expect(fs.existsSync(path.join(paths.media, owner, input.cardId))).toBe(false);
    store.close();
  });
});
