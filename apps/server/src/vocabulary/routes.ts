// Household vocabulary API. The cookie is not the monitor admin cookie.
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { AppError, VOCABULARY_CATEGORIES, VOCAB_ACTIONS, toAppError, type ProviderPreset, type VocabActionKind, type VocabularyCategoryId } from '@kt/shared';
import { clientAddress, readCookie, sameOrigin } from '../monitor/auth';
import { vocabularyCardId } from './telemetry';
import type { CardQuery, StoredCard, VocabularyLibraryStore, VocabularyMediaKind } from './store';

export const VOCAB_COOKIE = 'kt_vocab';
const CATEGORY_IDS = VOCABULARY_CATEGORIES.map((item) => item.id) as [VocabularyCategoryId, ...VocabularyCategoryId[]];

const pairHits = new Map<string, number[]>();

function allowPair(ip: string, now = Date.now()): boolean {
  const recent = (pairHits.get(ip) ?? []).filter((stamp) => now - stamp < 10 * 60_000);
  if (recent.length >= 20) {
    pairHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  pairHits.set(ip, recent);
  return true;
}

function cookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${VOCAB_COOKIE}=${encodeURIComponent(token)}; Path=/api/vocabulary; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

function cleared(secure: boolean): string {
  return `${VOCAB_COOKIE}=; Path=/api/vocabulary; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function secureCookie(req: Request): boolean {
  return req.header('x-forwarded-proto') === 'https' || req.secure === true;
}

const CardSchema = z.object({
  cardId: z.string(),
  createdAt: z.number(),
  imageHash: z.string(),
  zh: z.string(),
  sv: z.string(),
  article: z.enum(['en', 'ett']).nullable(),
  category: z.enum(CATEGORY_IDS),
  imageBase64: z.string().min(1).max(2_200_000),
  thumbBase64: z.string().min(1).max(800_000),
  zhAudioBase64: z.string().max(2_800_000).nullable().optional(),
  svAudioBase64: z.string().max(2_800_000).nullable().optional(),
});

const PatchSchema = z
  .object({
    zh: z.string().optional(),
    sv: z.string().optional(),
    article: z.enum(['en', 'ett']).nullable().optional(),
    category: z.enum(CATEGORY_IDS).optional(),
  })
  .refine((value) => value.zh !== undefined || value.sv !== undefined || value.article !== undefined || value.category !== undefined, 'empty patch');

const MediaSchema = z.object({
  imageHash: z.string(),
  imageBase64: z.string().min(1).max(2_200_000),
  thumbBase64: z.string().min(1).max(800_000),
});

const ActionSchema = z.object({
  kind: z.enum(VOCAB_ACTIONS),
  preset: z.enum(['mock', 'cloud', 'local']).default('cloud'),
  cardId: z.string().max(80).nullable().optional(),
});

export type VocabularyRouterOptions = {
  recordAction?: (kind: VocabActionKind, cardId: string | null, preset: ProviderPreset) => void;
};

function decode(value: string | null | undefined, max: number): Uint8Array | null {
  if (!value) return null;
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length === 0 || bytes.length > max) throw new AppError('BAD_REQUEST', 'bad media');
  return bytes;
}

function publicCard(card: StoredCard) {
  return {
    ...card,
    thumbUrl: `/api/vocabulary/media/${card.id}/thumb?v=${card.updatedAt}`,
    imageUrl: `/api/vocabulary/media/${card.id}/image?v=${card.updatedAt}`,
    zhAudioUrl: card.hasZhAudio ? `/api/vocabulary/media/${card.id}/zh` : null,
    svAudioUrl: card.hasSvAudio ? `/api/vocabulary/media/${card.id}/sv` : null,
  };
}

export function createVocabularyRouter(store: VocabularyLibraryStore, options: VocabularyRouterOptions = {}): Router {
  const router = Router();
  const small = express.json({ limit: '16kb' });
  const body = express.json({ limit: '8mb' });

  const ownerOf = (req: Request): string => {
    const ownerId = store.ownerForToken(readCookie(req, VOCAB_COOKIE));
    if (!ownerId) throw new AppError('BAD_REQUEST', 'not paired', 'NOT_PAIRED');
    return ownerId;
  };

  const guardWrite = (req: Request, _res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && !sameOrigin(req)) {
      next(new AppError('BAD_REQUEST', 'bad origin'));
      return;
    }
    next();
  };

  router.get('/session', (req, res) => {
    res.json({ paired: store.ownerForToken(readCookie(req, VOCAB_COOKIE)) !== null });
  });

  router.post('/pair', small, (req, res) => {
    if (!sameOrigin(req)) throw new AppError('BAD_REQUEST', 'bad origin');
    if (!allowPair(clientAddress(req))) {
      res.status(429).json({ error: { category: 'BAD_REQUEST', code: 'TOO_MANY_ATTEMPTS' } });
      return;
    }
    const code = (req.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string') throw new AppError('BAD_REQUEST', 'pairing code required');
    const session = store.pair(code);
    res.setHeader('Set-Cookie', cookie(session.token, session.maxAgeSec, secureCookie(req)));
    res.json({ paired: true, created: session.created });
  });

  router.post('/logout', (req, res) => {
    store.revoke(readCookie(req, VOCAB_COOKIE));
    res.setHeader('Set-Cookie', cleared(secureCookie(req)));
    res.json({ paired: false });
  });

  router.use(guardWrite);

  router.post('/cards', body, (req, res) => {
    const ownerId = ownerOf(req);
    const parsed = CardSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid card');
    const data = parsed.data;
    const result = store.save(ownerId, {
      cardId: data.cardId,
      createdAt: data.createdAt,
      imageHash: data.imageHash,
      zh: data.zh,
      sv: data.sv,
      article: data.article,
      category: data.category,
      image: decode(data.imageBase64, 1_500_000) ?? new Uint8Array(),
      thumb: decode(data.thumbBase64, 400_000) ?? new Uint8Array(),
      zhAudio: decode(data.zhAudioBase64, 2_000_000),
      svAudio: decode(data.svAudioBase64, 2_000_000),
    });
    res.status(result.status === 'saved' ? 201 : 200).json({ status: result.status, card: publicCard(result.card) });
  });

  router.get('/cards', (req, res) => {
    const ownerId = ownerOf(req);
    const parsed = z
      .object({
        category: z.enum(CATEGORY_IDS).optional(),
        from: z.coerce.number().int().optional(),
        to: z.coerce.number().int().optional(),
        q: z.string().trim().max(40).optional(),
        sort: z.enum(['newest', 'oldest', 'zh', 'sv']).default('newest'),
        limit: z.coerce.number().int().min(1).max(48).default(24),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      })
      .safeParse(req.query);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid query');
    const query: CardQuery = {
      category: parsed.data.category,
      from: parsed.data.from,
      to: parsed.data.to,
      q: parsed.data.q || undefined,
      sort: parsed.data.sort,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    };
    const page = store.list(ownerId, query);
    res.json({ cards: page.cards.map((card) => publicCard(card)), total: page.total, limit: query.limit, offset: query.offset });
  });

  router.get('/cards/:cardId', (req, res) => {
    const card = store.get(ownerOf(req), String(req.params.cardId));
    if (!card) {
      res.status(404).json({ error: { category: 'BAD_REQUEST' } });
      return;
    }
    res.json({ card: publicCard(card) });
  });

  router.post('/cards/:cardId/image', body, (req, res) => {
    const parsed = MediaSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid image');
    const image = decode(parsed.data.imageBase64, 1_500_000);
    const thumb = decode(parsed.data.thumbBase64, 400_000);
    if (!image || !thumb) throw new AppError('BAD_REQUEST', 'image required');
    const card = store.replaceImage(ownerOf(req), String(req.params.cardId), {
      imageHash: parsed.data.imageHash,
      image,
      thumb,
    });
    res.json({ card: publicCard(card) });
  });

  router.post('/actions', small, (req, res) => {
    const parsed = ActionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid vocabulary action');
    try {
      options.recordAction?.(parsed.data.kind, vocabularyCardId(parsed.data.cardId ?? undefined), parsed.data.preset);
    } catch {
      // Monitoring must not block the child.
    }
    res.status(204).end();
  });

  router.patch('/cards/:cardId', small, (req, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid card patch');
    const card = store.update(ownerOf(req), String(req.params.cardId), parsed.data);
    res.json({ card: publicCard(card) });
  });

  router.post('/cards/:cardId/audio', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
    const language = req.header('x-language');
    if (language !== 'zh' && language !== 'sv') throw new AppError('BAD_REQUEST', 'invalid audio language');
    const bytes = req.body as unknown;
    if (!Buffer.isBuffer(bytes)) throw new AppError('BAD_REQUEST', 'audio body required');
    const card = store.attachAudio(ownerOf(req), String(req.params.cardId), language, new Uint8Array(bytes));
    res.json({ card: publicCard(card) });
  });

  router.delete('/cards/:cardId', (req, res) => {
    const removed = store.remove(ownerOf(req), String(req.params.cardId));
    if (!removed) {
      res.status(404).json({ error: { category: 'BAD_REQUEST' } });
      return;
    }
    res.status(204).end();
  });

  router.get('/media/:cardId/:kind', (req, res) => {
    const kind = String(req.params.kind);
    if (kind !== 'image' && kind !== 'thumb' && kind !== 'zh' && kind !== 'sv') {
      res.status(404).end();
      return;
    }
    const media = store.mediaFile(ownerOf(req), String(req.params.cardId), kind as VocabularyMediaKind);
    if (!media) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(media.file).pipe(res);
  });

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 0;
    if (status === 413) {
      res.status(413).json({ error: { category: 'BAD_REQUEST' } });
      return;
    }
    if (error instanceof AppError && error.code === 'NOT_PAIRED') {
      res.status(401).json({ error: { category: 'BAD_REQUEST', code: 'NOT_PAIRED' } });
      return;
    }
    const appError = toAppError(error, 'SERVER');
    const httpStatus = appError.category === 'BAD_REQUEST' ? 400 : 500;
    res.status(httpStatus).json({ error: { category: appError.category } });
  });

  return router;
}
