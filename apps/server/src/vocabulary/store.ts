// Household vocabulary library. Words and file paths live in this SQLite file.
// Image and audio bytes live only under mediaDir, never inside the database and never in telemetry.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { AppError, sniffImage, VOCABULARY_CATEGORIES, VOCABULARY_LIMITS, type SwedishArticle, type VocabularyCategoryId } from '@kt/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const CATEGORY_IDS = new Set<string>(VOCABULARY_CATEGORIES.map((item) => item.id));
const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = 2_000_000;
const MAX_THUMB_BYTES = 400_000;

export type VocabularyMediaKind = 'image' | 'thumb' | 'zh' | 'sv';

export type StoredCard = {
  id: string;
  createdAt: number;
  updatedAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category: VocabularyCategoryId;
  hasZhAudio: boolean;
  hasSvAudio: boolean;
};

export type CardDraft = {
  cardId: string;
  createdAt: number;
  imageHash: string;
  zh: string;
  sv: string;
  article: SwedishArticle | null;
  category: VocabularyCategoryId;
  image: Uint8Array;
  thumb: Uint8Array;
  zhAudio: Uint8Array | null;
  svAudio: Uint8Array | null;
};

export type CardPatch = {
  zh?: string;
  sv?: string;
  article?: SwedishArticle | null;
  category?: VocabularyCategoryId;
};

export type CardQuery = {
  category?: VocabularyCategoryId;
  from?: number;
  to?: number;
  q?: string;
  sort: 'newest' | 'oldest' | 'zh' | 'sv';
  limit: number;
  offset: number;
};

export type SaveResult = { status: 'saved' | 'exists'; card: StoredCard };

type CardRow = {
  card_id: string;
  created_at: number;
  updated_at: number;
  image_hash: string;
  zh: string;
  sv: string;
  article: string | null;
  category: string;
  image_rel: string;
  thumb_rel: string;
  zh_audio_rel: string | null;
  sv_audio_rel: string | null;
};

function extFor(bytes: Uint8Array): 'jpg' | 'png' | 'webp' {
  const kind = sniffImage(bytes);
  if (kind === 'jpeg') return 'jpg';
  if (kind === 'png' || kind === 'webp') return kind;
  throw new AppError('BAD_REQUEST', 'image type not allowed');
}

function assertImage(bytes: Uint8Array, max: number): 'jpg' | 'png' | 'webp' {
  if (bytes.length === 0 || bytes.length > max) throw new AppError('BAD_REQUEST', 'image size not allowed');
  return extFor(bytes);
}

function assertAudio(bytes: Uint8Array | null): Uint8Array | null {
  if (!bytes || bytes.length === 0) return null;
  if (bytes.length > MAX_AUDIO_BYTES) throw new AppError('BAD_REQUEST', 'audio too large');
  return bytes;
}

function assertLabel(value: string): string {
  const text = value.trim();
  if (!text || text.length > VOCABULARY_LIMITS.maxLabelChars) throw new AppError('BAD_REQUEST', 'label length');
  for (const char of text) {
    if (char.charCodeAt(0) < 32) throw new AppError('BAD_REQUEST', 'label characters');
  }
  return text;
}

function assertCategory(value: string): VocabularyCategoryId {
  if (!CATEGORY_IDS.has(value)) throw new AppError('BAD_REQUEST', 'unknown category');
  return value as VocabularyCategoryId;
}

function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) throw new AppError('BAD_REQUEST', 'invalid card id');
  return value.toLowerCase();
}

export class VocabularyLibraryStore {
  readonly raw: DatabaseSync;
  private readonly root: string;

  constructor(file: string, mediaDir: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.root = path.resolve(mediaDir);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS owners (
        owner_id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(owner_id),
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cards (
        owner_id TEXT NOT NULL REFERENCES owners(owner_id),
        card_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        image_hash TEXT NOT NULL,
        zh TEXT NOT NULL,
        sv TEXT NOT NULL,
        article TEXT,
        category TEXT NOT NULL,
        image_rel TEXT NOT NULL,
        thumb_rel TEXT NOT NULL,
        zh_audio_rel TEXT,
        sv_audio_rel TEXT,
        PRIMARY KEY (owner_id, card_id),
        UNIQUE (owner_id, image_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_cards_owner_created ON cards(owner_id, created_at);
    `);
  }

  close(): void {
    this.raw.close();
  }

  /** First use of a code creates the household. The same code on another device joins it. */
  pair(code: string, now = Date.now()): { token: string; ownerId: string; created: boolean; maxAgeSec: number } {
    const normalized = code.trim();
    if (normalized.length < 8 || normalized.length > 64) throw new AppError('BAD_REQUEST', 'pairing code length');
    for (const char of normalized) {
      if (char.charCodeAt(0) < 32) throw new AppError('BAD_REQUEST', 'pairing code characters');
    }
    const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const existing = this.raw.prepare('SELECT owner_id FROM owners WHERE code_hash = ?').get(codeHash) as { owner_id: string } | undefined;
    const created = !existing;
    const ownerId = existing?.owner_id ?? crypto.randomUUID();
    if (created) {
      this.raw.prepare('INSERT INTO owners(owner_id, code_hash, created_at) VALUES (?, ?, ?)').run(ownerId, codeHash, new Date(now).toISOString());
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    this.raw.prepare('INSERT INTO sessions(token_hash, owner_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, ownerId, now + SESSION_MS);
    return { token, ownerId, created, maxAgeSec: Math.floor(SESSION_MS / 1000) };
  }

  ownerForToken(token: string | undefined, now = Date.now()): string | null {
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = this.raw.prepare('SELECT owner_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { owner_id: string; expires_at: number }
      | undefined;
    if (!row) return null;
    if (row.expires_at <= now) {
      this.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return row.owner_id;
  }

  revoke(token: string | undefined): void {
    if (!token) return;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    this.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  save(ownerId: string, draft: CardDraft): SaveResult {
    const cardId = assertUuid(draft.cardId);
    const imageHash = HASH_RE.test(draft.imageHash) ? draft.imageHash : '';
    if (!imageHash) throw new AppError('BAD_REQUEST', 'invalid image hash');
    const zh = assertLabel(draft.zh);
    const sv = assertLabel(draft.sv);
    const category = assertCategory(draft.category);
    const article = draft.article;
    if (article !== null && article !== 'en' && article !== 'ett') throw new AppError('BAD_REQUEST', 'invalid article');
    const createdAt = draft.createdAt;
    if (!Number.isInteger(createdAt) || createdAt < Date.UTC(2020, 0, 1) || createdAt > Date.now() + 86_400_000) {
      throw new AppError('BAD_REQUEST', 'invalid timestamp');
    }
    const actualHash = crypto.createHash('sha256').update(draft.image).digest('hex');
    if (actualHash !== imageHash) throw new AppError('BAD_REQUEST', 'image hash mismatch');
    const imageExt = assertImage(draft.image, VOCABULARY_LIMITS.maxImageBytes);
    const thumbExt = assertImage(draft.thumb, MAX_THUMB_BYTES);
    const zhAudio = assertAudio(draft.zhAudio);
    const svAudio = assertAudio(draft.svAudio);

    const current = this.row(ownerId, cardId);
    if (current) {
      if (current.image_hash !== imageHash) throw new AppError('BAD_REQUEST', 'card already has a different photo');
      return { status: 'exists', card: this.toCard(current) };
    }
    const samePhoto = this.raw.prepare('SELECT * FROM cards WHERE owner_id = ? AND image_hash = ?').get(ownerId, imageHash) as CardRow | undefined;
    if (samePhoto) return { status: 'exists', card: this.toCard(samePhoto) };

    const imageRel = `${ownerId}/${cardId}/image.${imageExt}`;
    const thumbRel = `${ownerId}/${cardId}/thumb.${thumbExt}`;
    const zhRel = zhAudio ? `${ownerId}/${cardId}/zh.mp3` : null;
    const svRel = svAudio ? `${ownerId}/${cardId}/sv.mp3` : null;
    this.writeRel(imageRel, draft.image);
    this.writeRel(thumbRel, draft.thumb);
    if (zhRel && zhAudio) this.writeRel(zhRel, zhAudio);
    if (svRel && svAudio) this.writeRel(svRel, svAudio);
    try {
      this.raw
        .prepare(
          `INSERT INTO cards(
             owner_id, card_id, created_at, updated_at, image_hash, zh, sv, article, category,
             image_rel, thumb_rel, zh_audio_rel, sv_audio_rel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ownerId, cardId, createdAt, createdAt, imageHash, zh, sv, article, category, imageRel, thumbRel, zhRel, svRel);
    } catch (error) {
      const winner =
        (this.raw.prepare('SELECT * FROM cards WHERE owner_id = ? AND card_id = ?').get(ownerId, cardId) as CardRow | undefined) ??
        (this.raw.prepare('SELECT * FROM cards WHERE owner_id = ? AND image_hash = ?').get(ownerId, imageHash) as CardRow | undefined);
      if (!winner || winner.card_id !== cardId) this.removeDir(ownerId, cardId);
      if (winner) return { status: 'exists', card: this.toCard(winner) };
      throw error;
    }
    const saved = this.row(ownerId, cardId);
    if (!saved) throw new AppError('SERVER', 'card missing after save');
    return { status: 'saved', card: this.toCard(saved) };
  }

  list(ownerId: string, query: CardQuery): { cards: StoredCard[]; total: number } {
    const filters: string[] = ['owner_id = ?'];
    const params: SQLInputValue[] = [ownerId];
    if (query.category) {
      filters.push('category = ?');
      params.push(query.category);
    }
    if (query.from !== undefined) {
      filters.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      filters.push('created_at <= ?');
      params.push(query.to);
    }
    if (query.q) {
      const needle = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      filters.push("(zh LIKE ? ESCAPE '\\' OR sv LIKE ? ESCAPE '\\')");
      params.push(needle, needle);
    }
    const where = filters.join(' AND ');
    const order =
      query.sort === 'oldest' ? 'created_at ASC, card_id ASC' : query.sort === 'zh' ? 'zh COLLATE NOCASE ASC, card_id ASC' : query.sort === 'sv' ? 'sv COLLATE NOCASE ASC, card_id ASC' : 'created_at DESC, card_id ASC';
    const total = (this.raw.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${where}`).get(...params) as { n: number }).n;
    const rows = this.raw.prepare(`SELECT * FROM cards WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, query.limit, query.offset) as CardRow[];
    return { cards: rows.map((row) => this.toCard(row)), total };
  }

  get(ownerId: string, cardId: string): StoredCard | null {
    const row = this.row(ownerId, assertUuid(cardId));
    return row ? this.toCard(row) : null;
  }

  update(ownerId: string, cardId: string, patch: CardPatch, now = Date.now()): StoredCard {
    const id = assertUuid(cardId);
    const row = this.row(ownerId, id);
    if (!row) throw new AppError('BAD_REQUEST', 'missing card');
    const zh = patch.zh === undefined ? row.zh : assertLabel(patch.zh);
    const sv = patch.sv === undefined ? row.sv : assertLabel(patch.sv);
    const article = patch.article === undefined ? row.article : patch.article;
    if (article !== null && article !== 'en' && article !== 'ett') throw new AppError('BAD_REQUEST', 'invalid article');
    const category = patch.category === undefined ? assertCategory(row.category) : assertCategory(patch.category);
    this.raw.prepare('UPDATE cards SET zh = ?, sv = ?, article = ?, category = ?, updated_at = ? WHERE owner_id = ? AND card_id = ?').run(zh, sv, article, category, now, ownerId, id);
    const next = this.row(ownerId, id);
    if (!next) throw new AppError('SERVER', 'card missing after update');
    return this.toCard(next);
  }

  attachAudio(ownerId: string, cardId: string, language: 'zh' | 'sv', bytes: Uint8Array): StoredCard {
    const id = assertUuid(cardId);
    const row = this.row(ownerId, id);
    if (!row) throw new AppError('BAD_REQUEST', 'missing card');
    const audio = assertAudio(bytes);
    if (!audio) throw new AppError('BAD_REQUEST', 'empty audio');
    const column = language === 'zh' ? 'zh_audio_rel' : 'sv_audio_rel';
    const existing = language === 'zh' ? row.zh_audio_rel : row.sv_audio_rel;
    if (!existing) {
      const rel = `${ownerId}/${id}/${language}.mp3`;
      this.writeRel(rel, audio);
      this.raw.prepare(`UPDATE cards SET ${column} = ?, updated_at = ? WHERE owner_id = ? AND card_id = ?`).run(rel, Date.now(), ownerId, id);
    }
    const next = this.row(ownerId, id);
    if (!next) throw new AppError('SERVER', 'card missing after audio');
    return this.toCard(next);
  }

  remove(ownerId: string, cardId: string): boolean {
    const id = assertUuid(cardId);
    const result = this.raw.prepare('DELETE FROM cards WHERE owner_id = ? AND card_id = ?').run(ownerId, id);
    this.removeDir(ownerId, id);
    return Number(result.changes) > 0;
  }

  /** Absolute path inside the media root, or null. Never follows a caller-supplied path. */
  mediaFile(ownerId: string, cardId: string, kind: VocabularyMediaKind): { file: string; mimeType: string } | null {
    let id: string;
    try {
      id = assertUuid(cardId);
    } catch {
      return null;
    }
    const row = this.row(ownerId, id);
    if (!row) return null;
    const rel = kind === 'image' ? row.image_rel : kind === 'thumb' ? row.thumb_rel : kind === 'zh' ? row.zh_audio_rel : row.sv_audio_rel;
    if (!rel) return null;
    const file = this.safeFile(rel);
    if (!file || !fs.existsSync(file)) return null;
    const mimeType = rel.endsWith('.png') ? 'image/png' : rel.endsWith('.webp') ? 'image/webp' : rel.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg';
    return { file, mimeType };
  }

  private row(ownerId: string, cardId: string): CardRow | undefined {
    return this.raw.prepare('SELECT * FROM cards WHERE owner_id = ? AND card_id = ?').get(ownerId, cardId) as CardRow | undefined;
  }

  private toCard(row: CardRow): StoredCard {
    return {
      id: row.card_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageHash: row.image_hash,
      zh: row.zh,
      sv: row.sv,
      article: row.article === 'en' || row.article === 'ett' ? row.article : null,
      category: assertCategory(row.category),
      hasZhAudio: row.zh_audio_rel !== null,
      hasSvAudio: row.sv_audio_rel !== null,
    };
  }

  private safeFile(rel: string): string | null {
    if (rel.includes('..') || path.isAbsolute(rel)) return null;
    const file = path.resolve(this.root, rel);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (file !== this.root && !file.startsWith(rootWithSep)) return null;
    return file;
  }

  private writeRel(rel: string, bytes: Uint8Array): void {
    const file = this.safeFile(rel);
    if (!file) throw new AppError('BAD_REQUEST', 'invalid media path');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const partial = `${file}.partial`;
    fs.writeFileSync(partial, bytes, { mode: 0o600 });
    fs.renameSync(partial, file);
  }

  private removeDir(ownerId: string, cardId: string): void {
    const dir = this.safeFile(`${ownerId}/${cardId}`);
    if (!dir) return;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
