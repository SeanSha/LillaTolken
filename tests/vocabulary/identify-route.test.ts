import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, VOCABULARY_LIMITS, type VocabularyIdentifyResponse } from '@kt/shared';
import { createApp } from '../../apps/server/src/app';
import { loadConfig } from '../../apps/server/src/config';
import { createRegistry } from '../../apps/server/src/providers/registry';
import { createVocabularyIdentifier, type VocabularyIdentifier } from '../../apps/server/src/vocabulary/identify';
import type { TelemetryDb } from '../../apps/server/src/telemetry/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../apps/server/data');

function jpeg(size = 32): Buffer {
  const body = Buffer.alloc(size, 0);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  return body;
}

function filesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

let server: Server;
let baseUrl = '';
let db: TelemetryDb;
const seen: Uint8Array[] = [];
let localCalls = 0;

const vocabulary: VocabularyIdentifier = {
  async identify(image): Promise<VocabularyIdentifyResponse> {
    seen.push(image.bytes);
    if (image.bytes[3] === 7) {
      return {
        outcome: 'person',
        candidates: [{ zh: '不应出现', sv: 'person', article: null, translationUncertain: false, category: 'other' }],
      };
    }
    if (image.bytes[3] === 9) throw new AppError('INVALID_MODEL_OUTPUT', 'vocabulary result failed schema validation');
    return { outcome: 'object', candidates: [{ zh: '苹果', sv: 'äpple', article: 'ett', translationUncertain: false, category: 'other' }] };
  },
};

const localVocabulary: VocabularyIdentifier = {
  async identify(_image, _signal, report) {
    localCalls += 1;
    report?.({ promptTokens: 10, outputTokens: 4, engineInferenceMs: 1200, modelLoadMs: 300 });
    return { outcome: 'object', candidates: [{ zh: '杯子', sv: 'kopp', article: 'en', translationUncertain: false, category: 'home' }] };
  },
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const config = loadConfig({
    PERSIST_EVENTS: 'off',
    LOCAL_ENABLED: 'off',
    MONITOR_DB_PATH: ':memory:',
    MONITOR_ADMIN_PASSWORD: 'test-admin-password',
  } as NodeJS.ProcessEnv);
  const created = createApp({ config, registry: createRegistry(config), vocabulary, localVocabulary });
  db = created.db;
  await new Promise<void>((resolve) => {
    server = created.app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const postImage = (body: Buffer, type = 'image/jpeg', headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/api/vocabulary/identify`, {
    method: 'POST',
    headers: { 'Content-Type': type, ...headers },
    body: new Uint8Array(body),
  });

describe('POST /api/vocabulary/identify', () => {
  it('returns a card and does not write the photo into the server data directory', async () => {
    const before = filesIn(dataDir);
    const response = await postImage(jpeg());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      outcome: 'object',
      candidates: [{ zh: '苹果', sv: 'äpple', article: 'ett', translationUncertain: false, category: 'other' }],
    });
    expect(filesIn(dataDir)).toEqual(before);
    expect(seen).toHaveLength(1);
  });

  it('strips a person label even if the identifier returned one', async () => {
    const body = jpeg();
    body[3] = 7;
    const response = await postImage(body);
    expect(await response.json()).toEqual({ outcome: 'person', candidates: [] });
  });

  it('rejects the wrong type, a mismatch, an empty body, and a broken model result', async () => {
    expect((await postImage(Buffer.from('GIF89a'), 'image/gif')).status).toBe(400);
    expect((await postImage(jpeg(), 'image/png')).status).toBe(400);
    expect((await postImage(Buffer.alloc(0), 'image/jpeg')).status).toBe(400);
    const broken = jpeg();
    broken[3] = 9;
    expect((await postImage(broken)).status).toBe(502);
    const huge = jpeg(VOCABULARY_LIMITS.maxImageBytes + 1);
    expect((await postImage(huge)).status).toBe(413);
  });

  it('stays unavailable when the server has no API key', async () => {
    const identifier = createVocabularyIdentifier({
      apiKey: undefined,
      asrModel: 'x',
      llmModel: 'x',
      visionModel: 'gpt-4.1-mini',
      ttsModel: 'x',
      ttsVoice: 'alloy',
      temperature: 0,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await expect(identifier.identify({ bytes: jpeg(), mimeType: 'image/jpeg', kind: 'jpeg' })).rejects.toMatchObject({ category: 'NOT_CONFIGURED' });
  });

  it('uses the local vision model for the local preset and records a zero-cost row', async () => {
    const cloudBefore = seen.length;
    const response = await postImage(jpeg(), 'image/jpeg', { 'X-Provider-Preset': 'local', 'X-Card-Id': 'card.local.1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: 'object',
      candidates: [{ zh: '杯子', sv: 'kopp', article: 'en', translationUncertain: false, category: 'home' }],
    });
    expect(seen).toHaveLength(cloudBefore);
    expect(localCalls).toBe(1);
    const row = db.get<{ preset: string; provider_name: string; model_tag: string; cost_usd: number | null; cost_basis: string; model_load_ms: number | null; status: string }>(
      `SELECT preset, provider_name, model_tag, cost_usd, cost_basis, model_load_ms, status FROM ai_requests WHERE card_id = ?`,
      'card.local.1',
    );
    expect(row).toMatchObject({
      preset: 'local',
      provider_name: 'local',
      model_tag: 'ollama:qwen3-vl:8b',
      cost_usd: 0,
      cost_basis: 'not_applicable',
      model_load_ms: 300,
      status: 'succeeded',
    });
  });

  it('keeps mock on the cloud identifier and records that call as cloud', async () => {
    const localBefore = localCalls;
    const response = await postImage(jpeg(), 'image/jpeg', { 'X-Provider-Preset': 'mock', 'X-Card-Id': 'card.mock.1' });
    expect(response.status).toBe(200);
    expect((await response.json()).candidates[0].zh).toBe('苹果');
    expect(localCalls).toBe(localBefore);
    const row = db.get<{ preset: string; provider_name: string }>(`SELECT preset, provider_name FROM ai_requests WHERE card_id = ?`, 'card.mock.1');
    expect(row).toEqual({ preset: 'cloud', provider_name: 'openai' });
  });

  it('rejects an unknown preset before either identifier runs', async () => {
    const cloudBefore = seen.length;
    const localBefore = localCalls;
    const response = await postImage(jpeg(), 'image/jpeg', { 'X-Provider-Preset': 'somewhere' });
    expect(response.status).toBe(400);
    expect(seen).toHaveLength(cloudBefore);
    expect(localCalls).toBe(localBefore);
  });
});
