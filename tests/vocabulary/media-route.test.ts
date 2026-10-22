import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVocabularyRouter } from '../../apps/server/src/vocabulary/routes';
import { VocabularyLibraryStore } from '../../apps/server/src/vocabulary/store';
import { TelemetryDb } from '../../apps/server/src/telemetry/db';
import { vocabularyUsage } from '../../apps/server/src/telemetry/queries';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-vocab-route-'));
const store = new VocabularyLibraryStore(path.join(dir, 'vocabulary.sqlite'), path.join(dir, 'media'));
const db = new TelemetryDb(':memory:');
const app = express();
app.use(
  '/api/vocabulary',
  createVocabularyRouter(store, {
    recordAction: (kind, cardId, preset) => db.recordVocabAction({ kind, cardId, preset }),
  }),
);

let server: Server;
let base = '';

function jpeg(mark: number): Buffer {
  const body = Buffer.alloc(32, mark);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  body[3] = 0xe0;
  return body;
}

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('household photo replacement route', () => {
  it('replaces the synced photo and records the action without a vision call', async () => {
    const paired = await fetch(`${base}/api/vocabulary/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'family-route' }),
    });
    const cookie = paired.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const image = jpeg(9);
    const cardId = crypto.randomUUID();
    const saved = await fetch(`${base}/api/vocabulary/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        cardId,
        createdAt: Date.UTC(2026, 0, 2),
        imageHash: crypto.createHash('sha256').update(image).digest('hex'),
        zh: '汽车',
        sv: 'bil',
        article: 'en',
        category: 'vehicles',
        imageBase64: image.toString('base64'),
        thumbBase64: jpeg(1).toString('base64'),
        zhAudioBase64: Buffer.from([7, 7]).toString('base64'),
        svAudioBase64: Buffer.from([8, 8]).toString('base64'),
      }),
    });
    expect(saved.status).toBe(201);

    const next = jpeg(4);
    const replaced = await fetch(`${base}/api/vocabulary/cards/${cardId}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        imageHash: crypto.createHash('sha256').update(next).digest('hex'),
        imageBase64: next.toString('base64'),
        thumbBase64: jpeg(2).toString('base64'),
      }),
    });
    expect(replaced.status).toBe(200);
    const body = (await replaced.json()) as { card: { id: string; zh: string; sv: string; article: string; category: string; hasZhAudio: boolean; hasSvAudio: boolean; imageUrl: string } };
    expect(body.card).toMatchObject({ id: cardId, zh: '汽车', sv: 'bil', article: 'en', category: 'vehicles', hasZhAudio: true, hasSvAudio: true });
    expect(body.card.imageUrl).toContain('?v=');

    const media = await fetch(`${base}${body.card.imageUrl}`, { headers: { Cookie: cookie } });
    expect(Buffer.from(await media.arrayBuffer()).equals(next)).toBe(true);

    const action = await fetch(`${base}/api/vocabulary/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'direct_replace', preset: 'cloud', cardId }),
    });
    expect(action.status).toBe(204);
    const report = vocabularyUsage(db, {});
    expect(report.identify.requests).toBe(0);
    expect(report.actions.direct_replace).toBe(1);
  });
});
