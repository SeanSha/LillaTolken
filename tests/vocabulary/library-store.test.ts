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

  it('replaces the photo without touching words or audio, and keeps the old photo if the new one is rejected', () => {
    const paths = place();
    const store = new VocabularyLibraryStore(paths.db, paths.media);
    const owner = store.pair('family-code').ownerId;
    const input = draft(9);
    const saved = store.save(owner, { ...input, zhAudio: Uint8Array.from([1, 2, 3]), svAudio: Uint8Array.from([4, 5]) });
    store.attachAudio(owner, saved.card.id, 'zh', Uint8Array.from([1, 2, 3]));
    const before = store.mediaFile(owner, saved.card.id, 'image');
    const oldBytes = before ? fs.readFileSync(before.file) : Buffer.alloc(0);
    const audio = store.mediaFile(owner, saved.card.id, 'sv');

    const next = jpeg(12);
    const imageHash = crypto.createHash('sha256').update(next).digest('hex');
    const replaced = store.replaceImage(owner, saved.card.id, { imageHash, image: new Uint8Array(next), thumb: new Uint8Array(jpeg(2)) });
    expect(replaced.id).toBe(saved.card.id);
    expect(replaced.zh).toBe('苹果');
    expect(replaced.sv).toBe('äpple');
    expect(replaced.article).toBe('ett');
    expect(replaced.category).toBe('food');
    expect(replaced.hasZhAudio).toBe(true);
    expect(replaced.hasSvAudio).toBe(true);
    expect(replaced.imageHash).toBe(imageHash);
    expect(store.mediaFile(owner, saved.card.id, 'sv')?.file).toBe(audio?.file);
    expect(fs.readFileSync(store.mediaFile(owner, saved.card.id, 'image')!.file).equals(next)).toBe(true);
    expect(fs.existsSync(before!.file)).toBe(false);

    const broken = jpeg(15);
    expect(() =>
      store.replaceImage(owner, saved.card.id, {
        imageHash: crypto.createHash('sha256').update(broken).digest('hex'),
        image: new Uint8Array(broken),
        thumb: Uint8Array.from([1, 2, 3]),
      }),
    ).toThrow(/image/);
    expect(store.get(owner, saved.card.id)?.imageHash).toBe(imageHash);
    expect(fs.readFileSync(store.mediaFile(owner, saved.card.id, 'image')!.file).equals(next)).toBe(true);
    expect(store.get(owner, saved.card.id)?.hasSvAudio).toBe(true);

    const other = store.save(owner, draft(4, crypto.randomUUID()));
    expect(() => store.replaceImage(owner, saved.card.id, { imageHash: other.card.imageHash, image: draft(4).image, thumb: new Uint8Array(jpeg(1)) })).toThrow(/already saved/);
    expect(store.get(owner, saved.card.id)?.imageHash).toBe(imageHash);

    const renamed = store.update(owner, saved.card.id, { zh: '苹果汁' });
    expect(renamed.hasZhAudio).toBe(false);
    expect(renamed.hasSvAudio).toBe(true);
    expect(store.mediaFile(owner, saved.card.id, 'zh')).toBeNull();
    const category = store.update(owner, saved.card.id, { category: 'toys' });
    expect(category.hasSvAudio).toBe(true);
    expect(category.zh).toBe('苹果汁');
    expect(oldBytes.equals(Buffer.from(input.image))).toBe(true);
    store.close();
  });
});
