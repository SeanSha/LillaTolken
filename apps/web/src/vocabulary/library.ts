import { vocabularyCategory, type SwedishArticle, type VocabularyCategoryId } from '@kt/shared';
import { spokenLabel } from './identity';

export type VocabularyCard = {
  id: string;
  createdAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  /** Missing on cards saved before categories existed. Treat that as 其他 / Annat. */
  category?: VocabularyCategoryId;
  /** manual is a parent's choice and must not be replaced by a later guess. */
  categorySource?: 'auto' | 'manual' | 'unset';
  image: Blob;
  thumb?: Blob | null;
  zhAudio: Blob | null;
  svAudio: Blob | null;
};

export type SyncStatus = 'synced' | 'pending' | 'error';

export type SyncRow = {
  localId: string;
  remoteId: string | null;
  status: SyncStatus;
  detail: string | null;
};

export type VocabularySummary = {
  id: string;
  createdAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category?: VocabularyCategoryId;
  categorySource?: 'auto' | 'manual' | 'unset';
  hasZhAudio: boolean;
  hasSvAudio: boolean;
  hasThumb: boolean;
};

export function cardCategory(card: { category?: string | null }): VocabularyCategoryId {
  return vocabularyCategory(card.category).id;
}

export function summarizeCard(card: VocabularyCard): VocabularySummary {
  return {
    id: card.id,
    createdAt: card.createdAt,
    imageHash: card.imageHash,
    zh: card.zh,
    sv: card.sv,
    article: card.article,
    category: card.category,
    categorySource: card.categorySource,
    hasZhAudio: card.zhAudio !== null,
    hasSvAudio: card.svAudio !== null,
    hasThumb: Boolean(card.thumb && card.thumb.size > 0),
  };
}

export class DuplicateCardError extends Error {
  readonly existingId: string;
  constructor(existingId: string) {
    super('DUPLICATE_CARD');
    this.name = 'DuplicateCardError';
    this.existingId = existingId;
  }
}

export type VocabularyLibrary = {
  list(): Promise<VocabularyCard[]>;
  /** Metadata only. The gallery uses this and then loads one page of thumbnails. */
  listSummaries(): Promise<VocabularySummary[]>;
  /** Small JPEG written beside the card. Null for cards saved before thumbnails. */
  thumb(id: string): Promise<Blob | null>;
  get(id: string): Promise<VocabularyCard | null>;
  findByHash(imageHash: string): Promise<VocabularyCard | null>;
  add(card: VocabularyCard): Promise<void>;
  update(id: string, patch: CardTextPatch): Promise<VocabularyCard>;
  /** Swaps the photo only. Words, category, audio, id, and createdAt stay. */
  replaceImage(id: string, media: { image: Blob; thumb: Blob | null; imageHash: string }): Promise<VocabularyCard>;
  saveAudio(id: string, language: 'zh' | 'sv', audio: Blob): Promise<VocabularyCard>;
  remove(id: string): Promise<void>;
  syncGet(localId: string): Promise<SyncRow | null>;
  syncPut(row: SyncRow): Promise<void>;
  syncList(): Promise<SyncRow[]>;
  close(): Promise<void>;
};

const DB_NAME = 'kt-vocabulary';
const STORE = 'cards';
const SUMMARY = 'summaries';
const THUMBS = 'thumbs';
const SYNC = 'sync';
const DB_VERSION = 2;

export type CardTextPatch = {
  zh?: string;
  sv?: string;
  article?: SwedishArticle | null;
  category?: VocabularyCategoryId;
  categorySource?: 'auto' | 'manual' | 'unset';
};

/** Drops cached speech only for the language whose spoken line changed. */
export function applyCardPatch(card: VocabularyCard, patch: CardTextPatch): VocabularyCard {
  const next: VocabularyCard = { ...card, ...patch };
  if (spokenLabel(card, 'zh') !== spokenLabel(next, 'zh')) next.zhAudio = null;
  if (spokenLabel(card, 'sv') !== spokenLabel(next, 'sv')) next.svAudio = null;
  return next;
}

export type NewVocabularyCard = {
  id?: string;
  image: Blob;
  thumb?: Blob | null;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category?: VocabularyCategoryId;
  categorySource?: 'auto' | 'manual' | 'unset';
  zhAudio?: Blob | null;
  svAudio?: Blob | null;
};

/** Refuses an empty label and a second save of the same compressed photo. */
export async function saveNewCard(library: VocabularyLibrary, input: NewVocabularyCard): Promise<VocabularyCard> {
  const zh = input.zh.trim();
  const sv = input.sv.trim();
  if (!zh || !sv) throw new Error('INCOMPLETE_CARD');
  if (input.id) {
    const sameId = await library.get(input.id);
    if (sameId) throw new DuplicateCardError(sameId.id);
  }
  const existing = await library.findByHash(input.imageHash);
  if (existing) throw new DuplicateCardError(existing.id);
  const card: VocabularyCard = {
    id: input.id ?? crypto.randomUUID(),
    createdAt: Date.now(),
    imageHash: input.imageHash,
    zh,
    sv,
    article: input.article,
    category: input.category ?? 'other',
    categorySource: input.categorySource ?? 'auto',
    image: input.image,
    thumb: input.thumb ?? null,
    zhAudio: input.zhAudio ?? null,
    svAudio: input.svAudio ?? null,
  };
  try {
    await library.add(card);
  } catch (error) {
    if (error instanceof DuplicateCardError) throw error;
    if (isConstraintError(error)) {
      const again = await library.findByHash(input.imageHash);
      throw new DuplicateCardError(again?.id ?? card.id);
    }
    throw error;
  }
  return card;
}

export function cacheCardAudio(library: VocabularyLibrary, id: string, language: 'zh' | 'sv', audio: Blob): Promise<VocabularyCard> {
  return library.saveAudio(id, language, audio);
}

function isConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'ConstraintError';
}

export function createMemoryVocabularyLibrary(): VocabularyLibrary {
  const cards = new Map<string, VocabularyCard>();
  const sync = new Map<string, SyncRow>();
  return {
    async list() {
      return [...cards.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async listSummaries() {
      return [...cards.values()].map(summarizeCard).sort((a, b) => b.createdAt - a.createdAt);
    },
    async thumb(id) {
      const card = cards.get(id);
      return card?.thumb && card.thumb.size > 0 ? card.thumb : null;
    },
    async get(id) {
      return cards.get(id) ?? null;
    },
    async findByHash(imageHash) {
      return [...cards.values()].find((card) => card.imageHash === imageHash) ?? null;
    },
    async add(card) {
      if (cards.has(card.id)) throw new DuplicateCardError(card.id);
      const existing = [...cards.values()].find((item) => item.imageHash === card.imageHash);
      if (existing) throw new DuplicateCardError(existing.id);
      cards.set(card.id, card);
    },
    async update(id, patch) {
      const card = cards.get(id);
      if (!card) throw new Error('MISSING_CARD');
      const next = applyCardPatch(card, patch);
      cards.set(id, next);
      return next;
    },
    async replaceImage(id, media) {
      const card = cards.get(id);
      if (!card) throw new Error('MISSING_CARD');
      if (card.imageHash === media.imageHash) return card;
      const clash = [...cards.values()].find((item) => item.imageHash === media.imageHash);
      if (clash) throw new DuplicateCardError(clash.id);
      const next = { ...card, image: media.image, thumb: media.thumb, imageHash: media.imageHash };
      cards.set(id, next);
      return next;
    },
    async saveAudio(id, language, audio) {
      const card = cards.get(id);
      if (!card) throw new Error('MISSING_CARD');
      const next = language === 'zh' ? { ...card, zhAudio: audio } : { ...card, svAudio: audio };
      cards.set(id, next);
      return next;
    },
    async remove(id) {
      cards.delete(id);
      sync.delete(id);
    },
    async syncGet(localId) {
      return sync.get(localId) ?? null;
    },
    async syncPut(row) {
      sync.set(row.localId, row);
    },
    async syncList() {
      return [...sync.values()];
    },
    async close() {},
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXED_DB'));
  });
}

/** Cards survive reloads on this device. Clearing site data deletes the database. */
export function createIndexedDbVocabularyLibrary(): VocabularyLibrary {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('imageHash', 'imageHash', { unique: true });
            store.createIndex('createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains(SUMMARY)) db.createObjectStore(SUMMARY, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC, { keyPath: 'localId' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          opening = null;
          reject(request.error ?? new Error('INDEXED_DB'));
        };
      });
    }
    return opening;
  };

  const txOf = async <T>(names: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> => {
    const db = await open();
    const tx = db.transaction(names, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('INDEXED_DB'));
      tx.onerror = () => reject(tx.error ?? new Error('INDEXED_DB'));
    });
    try {
      const result = await fn(tx);
      await finished;
      return result;
    } catch (error) {
      finished.catch(() => undefined);
      try {
        tx.abort();
      } catch {
        // already finished or aborted
      }
      throw error;
    }
  };

  const writeSummary = (tx: IDBTransaction, card: VocabularyCard) => {
    tx.objectStore(SUMMARY).put(summarizeCard(card));
    if (card.thumb && card.thumb.size > 0) tx.objectStore(THUMBS).put({ id: card.id, blob: card.thumb });
  };

  return {
    async list() {
      const listed = await txOf([STORE], 'readonly', (tx) => requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<VocabularyCard[]>));
      return listed.sort((a, b) => b.createdAt - a.createdAt);
    },
    async listSummaries() {
      const existing = await txOf([SUMMARY], 'readonly', (tx) => requestToPromise(tx.objectStore(SUMMARY).getAll() as IDBRequest<VocabularySummary[]>));
      if (existing.length > 0) return existing.sort((a, b) => b.createdAt - a.createdAt);
      const cards = await txOf([STORE], 'readonly', (tx) => requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<VocabularyCard[]>));
      if (cards.length === 0) return [];
      await txOf([SUMMARY], 'readwrite', async (tx) => {
        for (const card of cards) tx.objectStore(SUMMARY).put(summarizeCard(card));
      });
      return cards.map(summarizeCard).sort((a, b) => b.createdAt - a.createdAt);
    },
    async thumb(id) {
      const row = await txOf([THUMBS], 'readonly', (tx) => requestToPromise(tx.objectStore(THUMBS).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>));
      return row?.blob ?? null;
    },
    async get(id) {
      const row = await txOf([STORE], 'readonly', (tx) => requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<VocabularyCard | undefined>));
      return row ?? null;
    },
    async findByHash(imageHash) {
      const row = await txOf([STORE], 'readonly', (tx) =>
        requestToPromise(tx.objectStore(STORE).index('imageHash').get(imageHash) as IDBRequest<VocabularyCard | undefined>),
      );
      return row ?? null;
    },
    async add(card) {
      await txOf([STORE, SUMMARY, THUMBS], 'readwrite', async (tx) => {
        await requestToPromise(tx.objectStore(STORE).add(card));
        writeSummary(tx, card);
      });
    },
    async update(id, patch) {
      return txOf([STORE, SUMMARY, THUMBS], 'readwrite', async (tx) => {
        const current = await requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<VocabularyCard | undefined>);
        if (!current) throw new Error('MISSING_CARD');
        const next = applyCardPatch(current, patch);
        await requestToPromise(tx.objectStore(STORE).put(next));
        writeSummary(tx, next);
        return next;
      });
    },
    async replaceImage(id, media) {
      return txOf([STORE, SUMMARY, THUMBS], 'readwrite', async (tx) => {
        const store = tx.objectStore(STORE);
        const current = await requestToPromise(store.get(id) as IDBRequest<VocabularyCard | undefined>);
        if (!current) throw new Error('MISSING_CARD');
        if (current.imageHash === media.imageHash) return current;
        const clash = await requestToPromise(store.index('imageHash').get(media.imageHash) as IDBRequest<VocabularyCard | undefined>);
        if (clash && clash.id !== id) throw new DuplicateCardError(clash.id);
        const next: VocabularyCard = { ...current, image: media.image, thumb: media.thumb, imageHash: media.imageHash };
        await requestToPromise(store.put(next));
        writeSummary(tx, next);
        if (!next.thumb || next.thumb.size === 0) tx.objectStore(THUMBS).delete(next.id);
        return next;
      });
    },
    async saveAudio(id, language, audio) {
      return txOf([STORE, SUMMARY], 'readwrite', async (tx) => {
        const current = await requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<VocabularyCard | undefined>);
        if (!current) throw new Error('MISSING_CARD');
        const next = language === 'zh' ? { ...current, zhAudio: audio } : { ...current, svAudio: audio };
        await requestToPromise(tx.objectStore(STORE).put(next));
        tx.objectStore(SUMMARY).put(summarizeCard(next));
        return next;
      });
    },
    async remove(id) {
      await txOf([STORE, SUMMARY, THUMBS, SYNC], 'readwrite', async (tx) => {
        await requestToPromise(tx.objectStore(STORE).delete(id));
        await requestToPromise(tx.objectStore(SUMMARY).delete(id));
        await requestToPromise(tx.objectStore(THUMBS).delete(id));
        await requestToPromise(tx.objectStore(SYNC).delete(id));
      });
    },
    async syncGet(localId) {
      const row = await txOf([SYNC], 'readonly', (tx) => requestToPromise(tx.objectStore(SYNC).get(localId) as IDBRequest<SyncRow | undefined>));
      return row ?? null;
    },
    async syncPut(row) {
      await txOf([SYNC], 'readwrite', (tx) => requestToPromise(tx.objectStore(SYNC).put(row)));
    },
    async syncList() {
      return txOf([SYNC], 'readonly', (tx) => requestToPromise(tx.objectStore(SYNC).getAll() as IDBRequest<SyncRow[]>));
    },
    async close() {
      if (!opening) return;
      const db = await opening;
      db.close();
      opening = null;
    },
  };
}
