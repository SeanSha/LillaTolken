// Monitoring over REAL HTTP: auth (M09), Cloud-shaped usage rows (M01/M02/M04), simultaneous sessions (M07),
// failures (M08), export/clear without content (M10) and a full Local task through the real adapters
// (L01/L04/L05/L06/L07 logic) with mocked engines. Paid Cloud APIs are NEVER called here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, type AiStage, type ProviderBundle } from '@kt/shared';
import { createApp } from '../../apps/server/src/app';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config';
import { EventStore } from '../../apps/server/src/evaluation/eventStore';
import { clientAddress, resolveAdminPassword } from '../../apps/server/src/monitor/auth';
import { createLocalProvider, loadLocalConfig } from '../../apps/server/src/providers/local';
import { createRegistry, type ProviderRegistry } from '../../apps/server/src/providers/registry';
import type { TelemetryDb } from '../../apps/server/src/telemetry/db';
import { fakeFetch, fakeRunner, makeWav } from '../local/fakes';

const PASSWORD = 'test-admin-password';
const SENTINEL_ZH = '哈哈独特哨兵文本';
const SENTINEL_SV = 'unikt-vaktposttext';

// ---------------------------------------------------------------- fake Cloud (usage-reporting, no network)

const wavBytes = makeWav(1200, 22050);
const cloudBundle = (failTranslate: { on: boolean }): ProviderBundle => ({
  asr: {
    transcribe: async (audio, _l, meta) => {
      meta.report?.({ promptTokens: 25, outputTokens: 12 });
      return `${SENTINEL_ZH}:${audio.bytes.length}`;
    },
  },
  dialogue: {
    interpretChinese: async (_i, meta) => {
      meta.report?.({ promptTokens: 485, outputTokens: 28, cachedPromptTokens: 0 });
      return { kind: 'PROPOSE_MEANING', meaningZh: SENTINEL_ZH };
    },
    translate: async (_i, meta) => {
      if (failTranslate.on) throw new AppError('SERVER', `upstream leaked ${SENTINEL_SV}`);
      meta.report?.({ promptTokens: 123, outputTokens: 11 });
      return SENTINEL_SV;
    },
  },
  tts: { synthesize: async () => ({ bytes: wavBytes, mimeType: 'audio/wav', durationMs: 1200 }) }, // Cloud TTS reports no usage
});

// ---------------------------------------------------------------- helpers

type Harness = { baseUrl: string; db: TelemetryDb; server: Server; config: ServerConfig; failTranslate: { on: boolean }; localFetchLog: string[] };

async function boot(env: Record<string, string> = {}, localEngines: 'up' | 'down' = 'up'): Promise<Harness> {
  process.env.NODE_ENV = 'test';
  const config = loadConfig({ PERSIST_EVENTS: 'off', LOCAL_ENABLED: 'off', MONITOR_DB_PATH: ':memory:', MONITOR_ADMIN_PASSWORD: PASSWORD, ...env } as NodeJS.ProcessEnv);
  const failTranslate = { on: false };
  const localFetchLog: string[] = [];

  // Real Local adapters over mocked engines.
  const localCfg = loadLocalConfig({ LOCAL_TMP_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kt-mon-')) } as NodeJS.ProcessEnv, '/repo');
  const engines = fakeFetch({
    whisper: () => Response.json({ text: '我想去厕所。\n' }),
    chat: (body) => {
      const system = String((body.messages as Array<{ content: string }>)[0]!.content);
      const content = system.includes('interpret') || system.includes('Interpret') || body.format && JSON.stringify(body.format).includes('kind') ? { kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所。' } : { translation: 'Jag vill gå på toaletten.' };
      return Response.json({ message: { content: JSON.stringify(content) }, prompt_eval_count: 100, eval_count: 20, total_duration: 3_000_000_000, load_duration: 800_000_000 });
    },
  });
  const downFetch = (async (url: string | URL | Request) => {
    localFetchLog.push(String(url));
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const trackingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    localFetchLog.push(String(url));
    return engines.impl(url, init);
  }) as typeof fetch;
  const local = createLocalProvider(localCfg, { run: fakeRunner().run, fetchImpl: localEngines === 'up' ? trackingFetch : downFetch });
  await local.refresh(true);

  const base = createRegistry(config);
  const registry: ProviderRegistry = {
    ...base,
    cloud: {
      bundle: cloudBundle(failTranslate),
      modelTag: 'fake-cloud',
      available: true,
      providerName: 'openai',
      modelFor: (stage: AiStage) =>
        ({ ASR: 'gpt-4o-transcribe', INTERPRET: 'gpt-4.1-mini', TRANSLATE: 'gpt-4.1-mini', TTS: 'gpt-4o-mini-tts', IDENTIFY: 'gpt-4.1-mini' })[stage],
    },
    local: {
      bundle: local,
      modelTag: local.describe().modelTag,
      get available() {
        return local.describe().available;
      },
      providerName: 'local',
      modelFor: (stage) => local.modelFor(stage),
      localHealth: (force) => local.refresh(force),
      refresh: async () => void (await local.refresh()),
    },
  };
  const { app, db } = createApp({ config, registry, events: new EventStore() });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, db, server, config, failTranslate, localFetchLog };
}

const stop = (h: Harness) => new Promise<void>((resolve) => h.server.close(() => resolve()));

async function login(baseUrl: string, password = PASSWORD, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/monitor/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password }) });
  return { res, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

/** One full task through the HTTP API exactly like the browser client does. */
async function runTask(h: Harness, preset: 'mock' | 'cloud' | 'local', direction: 'ZH_TO_SV' | 'SV_TO_ZH', session = 'sessA') {
  const taskId = nextId('task');
  const hdr = (): Record<string, string> => ({ 'X-Provider-Preset': preset, 'X-Task-Id': taskId, 'X-Request-Id': nextId('req'), 'X-Session-Id': session, 'X-Direction': direction });
  const lang = direction === 'ZH_TO_SV' ? 'zh' : 'sv';
  const asr = await fetch(`${h.baseUrl}/api/asr?language=${lang}`, { method: 'POST', headers: { ...hdr(), 'Content-Type': 'audio/mp4', 'X-Duration-Ms': '3000', 'X-Mock-Transcript': encodeURIComponent(SENTINEL_ZH) }, body: new Uint8Array([1, 2, 3, 4, 5]) });
  const out = { taskId, asr, interpret: null as Response | null, translate: null as Response | null, tts: null as Response | null };
  if (!asr.ok) return out;
  const text = ((await asr.json()) as { text: string }).text;
  if (direction === 'ZH_TO_SV') {
    out.interpret = await fetch(`${h.baseUrl}/api/interpret`, { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ dialogueInputs: [{ purpose: 'INITIAL', textParts: [text] }], remainingClarifications: 3 }) });
    if (!out.interpret.ok) return out;
  }
  out.translate = await fetch(`${h.baseUrl}/api/translate`, { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text, direction }) });
  if (!out.translate.ok) return out;
  out.tts = await fetch(`${h.baseUrl}/api/tts`, { method: 'POST', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hej', language: direction === 'ZH_TO_SV' ? 'sv' : 'zh' }) });
  return out;
}

const get = async <T>(h: Harness, cookie: string, route: string): Promise<T> => {
  const res = await fetch(`${h.baseUrl}${route}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${route} -> ${res.status}`);
  return (await res.json()) as T;
};

// ================================================================ M09 access control

describe('M09: monitor access control', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot();
  });
  afterAll(() => stop(h));

  const protectedGets = [
    '/api/monitor/summary',
    '/api/monitor/requests',
    '/api/monitor/requests/x:ASR:1',
    '/api/monitor/tasks',
    '/api/monitor/tasks/t1',
    '/api/monitor/timeseries',
    '/api/monitor/pricing',
    '/api/monitor/settings',
    '/api/monitor/annotations',
    '/api/monitor/annotations/stats',
    '/api/monitor/export?type=requests&format=csv',
    '/api/monitor/export?type=tasks&format=csv',
    '/api/monitor/export?type=annotations&format=csv',
    '/api/monitor/health',
    '/api/local/health',
    '/api/events/export',
  ];

  it.each(protectedGets)('GET %s without a session -> 401 and no data', async (route) => {
    const res = await fetch(`${h.baseUrl}${route}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toBe('{"error":{"code":"UNAUTHORIZED"}}');
  });

  it('mutating / destructive routes are protected too, also with a forged or garbage cookie', async () => {
    for (const [method, route] of [['POST', '/api/monitor/settings'], ['POST', '/api/monitor/annotations'], ['DELETE', '/api/monitor/data'], ['DELETE', '/api/events']] as const) {
      expect((await fetch(`${h.baseUrl}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, `${method} ${route}`).toBe(401);
      expect((await fetch(`${h.baseUrl}${route}`, { method, headers: { 'Content-Type': 'application/json', Cookie: 'kt_monitor=forged' }, body: '{}' })).status).toBe(401);
    }
  });

  it('the session probe is public but reveals nothing; the translator API stays open (no regression)', async () => {
    const session = (await (await fetch(`${h.baseUrl}/api/monitor/session`)).json()) as { authenticated: boolean };
    expect(session.authenticated).toBe(false);
    expect((await fetch(`${h.baseUrl}/api/health`)).status).toBe(200);
  });

  it('login: wrong password -> 401; correct -> HttpOnly + SameSite=Strict cookie; logout revokes the session', async () => {
    expect((await login(h.baseUrl, 'wrong-password')).res.status).toBe(401);
    const { res, cookie } = await login(h.baseUrl);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api/);
    expect(setCookie).not.toContain(PASSWORD); // the password is never reflected
    expect((await fetch(`${h.baseUrl}/api/monitor/summary`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${h.baseUrl}/api/events/export`, { headers: { Cookie: cookie } })).status).toBe(200);

    await fetch(`${h.baseUrl}/api/monitor/logout`, { method: 'POST', headers: { Cookie: cookie } });
    expect((await fetch(`${h.baseUrl}/api/monitor/summary`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('throttles repeated wrong passwords per client (429) and a correct password cannot bypass the lockout', async () => {
    const attacker = { 'X-Forwarded-For': '198.51.100.7' };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await login(h.baseUrl, `guess-${i}-xxxx`, attacker)).res.status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    expect((await login(h.baseUrl, PASSWORD, attacker)).res.status).toBe(429);
    // another client is unaffected
    expect((await login(h.baseUrl, PASSWORD, { 'X-Forwarded-For': '198.51.100.8' })).res.status).toBe(200);
  });

  it('rotating a forged leading X-Forwarded-For entry cannot reset the lockout (only the proxy-appended last entry counts)', async () => {
    const proxyAppended = '198.51.100.99';
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await login(h.baseUrl, `bad-${i}-yyyy`, { 'X-Forwarded-For': `10.0.0.${i}, ${proxyAppended}` })).res.status;
    expect(last).toBe(429);
  });

  it('rejects cross-origin login and cross-origin mutations (CSRF defence in depth)', async () => {
    const evil = { Origin: 'https://evil.example' };
    expect((await login(h.baseUrl, PASSWORD, evil)).res.status).toBe(403);
    const { cookie } = await login(h.baseUrl, PASSWORD, { 'X-Forwarded-For': '198.51.100.50' });
    const res = await fetch(`${h.baseUrl}/api/monitor/data`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...evil }, body: JSON.stringify({ confirm: 'DELETE' }) });
    expect(res.status).toBe(403);
  });

  it('clientAddress uses the last forwarded hop', () => {
    const req = (xff?: string) => ({ header: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? xff : undefined), socket: { remoteAddress: '::1' } }) as never;
    expect(clientAddress(req('127.0.0.1, 192.168.1.5'))).toBe('192.168.1.5');
    expect(clientAddress(req('192.168.1.5'))).toBe('192.168.1.5');
    expect(clientAddress(req())).toBe('::1');
  });
});

describe('MONITOR_LOCAL_ONLY', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot({ MONITOR_LOCAL_ONLY: 'on' });
  });
  afterAll(() => stop(h));

  it('blocks monitor access from another device even with the right password and a spoofed leading XFF', async () => {
    const lan = { 'X-Forwarded-For': '127.0.0.1, 192.168.31.77' }; // proxy appended the real LAN client last
    const attempt = await login(h.baseUrl, PASSWORD, lan);
    expect(attempt.res.status).toBe(403);
    expect((await login(h.baseUrl)).res.status).toBe(200); // the Mac itself
  });
});

describe('admin password source', () => {
  it('has no built-in default: generates a random 0600 password once and reuses it; short env values are ignored', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-admin-'));
    const file = path.join(dir, 'data/monitor-admin-password');
    try {
      const warnings: string[] = [];
      const first = resolveAdminPassword({ file, warn: (m) => warnings.push(m), envPassword: 'short' });
      expect(first.source).toBe('generated');
      expect(first.password.length).toBeGreaterThanOrEqual(20);
      expect(['admin', 'password', 'monitor', 'changeme']).not.toContain(first.password);
      expect(warnings.join()).toMatch(/shorter/);
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
      const again = resolveAdminPassword({ file });
      expect(again).toMatchObject({ password: first.password, source: 'file' });
      expect(resolveAdminPassword({ file, envPassword: 'a-long-enough-env-password' })).toMatchObject({ source: 'env', password: 'a-long-enough-env-password' });
      const other = resolveAdminPassword({ file: path.join(dir, 'other') });
      expect(other.password).not.toBe(first.password);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ================================================================ data flows

describe('monitor data (Cloud/Local/Mock through one wrapper)', () => {
  let h: Harness;
  let cookie = '';
  beforeAll(async () => {
    h = await boot();
    cookie = (await login(h.baseUrl)).cookie;
  });
  afterAll(() => stop(h));

  it('M01/M04: a Cloud task links its model calls to ONE task; real token usage is priced from the registry with a revision', async () => {
    const task = await runTask(h, 'cloud', 'ZH_TO_SV', 'sessCloud');
    expect(task.tts?.status).toBe(200);
    const detail = await get<{ task: { requestCount: number; preset: string; direction: string; costKnownUsd: number; costUnknownRequests: number }; requests: Array<{ stage: AiStage; costUsd: number | null; costBasis: string; priceRevision: string | null; promptTokens: number | null; sessionId: string }> }>(h, cookie, `/api/monitor/tasks/${task.taskId}`);
    expect(detail.task).toMatchObject({ requestCount: 4, preset: 'cloud', direction: 'ZH_TO_SV' });
    const byStage = Object.fromEntries(detail.requests.map((r) => [r.stage, r]));
    expect(Object.keys(byStage).sort()).toEqual(['ASR', 'INTERPRET', 'TRANSLATE', 'TTS']);
    // INTERPRET: 485 in, 28 out @ gpt-4.1-mini 0.4/1.6 per MTok
    expect(byStage.INTERPRET!.costBasis).toBe('reported_usage');
    expect(byStage.INTERPRET!.costUsd).toBeCloseTo((485 * 0.4 + 28 * 1.6) / 1e6, 10);
    expect(byStage.INTERPRET!.priceRevision).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(byStage.INTERPRET!.promptTokens).toBe(485);
    // ASR: per-minute estimate from the 3 s upload
    expect(byStage.ASR!.costBasis).toBe('estimated');
    expect(byStage.ASR!.costUsd).toBeCloseTo((3 / 60) * 0.006, 10);
    // TTS: the endpoint reports no usage -> Unknown, NOT $0 (M03)
    expect(byStage.TTS!.costUsd).toBeNull();
    expect(byStage.TTS!.costBasis).toBe('unknown');
    expect(detail.task.costUnknownRequests).toBe(1);
    expect(detail.requests.every((r) => r.sessionId === 'sessCloud')).toBe(true);
  });

  it('pricing endpoint exposes the active registry read-only (revision, source) and cannot be written', async () => {
    const pricing = await get<{ revision: string; sourceUrl: string; editableOnlyOnServer: boolean; entries: unknown[] }>(h, cookie, '/api/monitor/pricing');
    expect(pricing.entries.length).toBeGreaterThan(0);
    expect(pricing.editableOnlyOnServer).toBe(true);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await fetch(`${h.baseUrl}/api/monitor/pricing`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status).toBeGreaterThanOrEqual(400);
    }
  });

  it('L01/L04-logic: a Local task works end-to-end through the real adapters, costs $0 (not Unknown), and reports ms from Ollama ns', async () => {
    const zh = await runTask(h, 'local', 'ZH_TO_SV', 'sessLocal');
    expect([zh.asr.status, zh.interpret?.status, zh.translate?.status, zh.tts?.status]).toEqual([200, 200, 200, 200]);
    expect(zh.tts?.headers.get('content-type')).toBe('audio/wav');
    const sv = await runTask(h, 'local', 'SV_TO_ZH', 'sessLocal');
    expect([sv.asr.status, sv.translate?.status, sv.tts?.status]).toEqual([200, 200, 200]);

    const requests = await get<{ rows: Array<{ preset: string; stage: AiStage; costUsd: number | null; costBasis: string; engineInferenceMs: number | null; modelLoadMs: number | null; conversionMs: number | null; inputAudioMs: number | null; outputAudioMs: number | null; modelTag: string; direction: string | null }> }>(h, cookie, '/api/monitor/requests?preset=local&limit=100');
    expect(requests.rows).toHaveLength(7);
    expect(requests.rows.every((r) => r.costUsd === 0 && r.costBasis === 'not_applicable')).toBe(true);
    const llm = requests.rows.find((r) => r.stage === 'INTERPRET')!;
    expect(llm.engineInferenceMs).toBe(2200); // 3.0 s total - 0.8 s load
    expect(llm.modelLoadMs).toBe(800);
    expect(llm.modelTag).toBe('ollama:qwen3:8b');
    const asr = requests.rows.find((r) => r.stage === 'ASR')!;
    expect(asr.conversionMs).not.toBeNull();
    expect(asr.inputAudioMs).toBe(2000); // the converted WAV, measured
    expect(asr.modelTag).toMatch(/^whisper\.cpp:/);
    const tts = requests.rows.find((r) => r.stage === 'TTS')!;
    expect(tts.outputAudioMs).toBe(1500); // media length (M06: generation vs playback are distinct)
    expect(new Set(requests.rows.map((r) => r.direction))).toContain('SV_TO_ZH');

    const summary = await get<{ cost: { cloudRequests: number }; presets: Array<{ preset: string; requests: number }> }>(h, cookie, '/api/monitor/summary?preset=local');
    expect(summary.cost.cloudRequests).toBe(0); // local never contributes Cloud cost
    expect(summary.presets.find((p) => p.preset === 'local')?.requests).toBe(7);
  });

  it('M06: TTS generation time and client playback time are separate measurements', async () => {
    const taskId = nextId('playtask');
    const ev = (eventType: string, extra: Record<string, unknown> = {}) => ({ ts: new Date().toISOString(), sessionId: 'sessPlay', taskId, providerPreset: 'local', version: 't', direction: 'ZH_TO_SV', eventType, ...extra });
    const post = await fetch(`${h.baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [ev('TASK_STARTED'), ev('TTS_READY', { stage: 'tts', stageDurationMs: 480 }), ev('PLAYBACK_COMPLETED', { playbackMs: 2300 }), ev('TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 9000 })] }),
    });
    expect(post.status).toBe(204);
    const { task } = await get<{ task: { playbackMs: number; taskElapsedMs: number; playbackCompleted: boolean } }>(h, cookie, `/api/monitor/tasks/${taskId}`);
    expect(task.playbackMs).toBe(2300);
    expect(task.taskElapsedMs).toBe(9000);
    expect(task.playbackCompleted).toBe(true);
  });

  it('M08: a failing Cloud call is recorded as failed (counted, not priced, sanitized) and the task is not "delivered"', async () => {
    h.failTranslate.on = true;
    const task = await runTask(h, 'cloud', 'SV_TO_ZH', 'sessFail');
    h.failTranslate.on = false;
    expect(task.translate?.status).toBeGreaterThanOrEqual(500);
    expect(task.tts).toBeNull();
    const detail = await get<{ requests: Array<{ stage: string; status: string; costUsd: number | null; errorCode: string | null }> }>(h, cookie, `/api/monitor/tasks/${task.taskId}`);
    const failed = detail.requests.find((r) => r.stage === 'TRANSLATE')!;
    expect(failed.status).toBe('failed');
    expect(failed.costUsd).toBeNull();
    // events: error then cancelled => failed task
    await fetch(`${h.baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: ['TASK_STARTED', 'ERROR', 'TASK_CANCELLED'].map((eventType) => ({ ts: new Date().toISOString(), sessionId: 'sessFail', taskId: task.taskId, providerPreset: 'cloud', version: 't', eventType, ...(eventType === 'ERROR' ? { stage: 'translate', errorCategory: 'SERVER' } : {}) })) }),
    });
    const after = await get<{ task: { status: string } }>(h, cookie, `/api/monitor/tasks/${task.taskId}`);
    expect(after.task.status).toBe('failed');
    const summary = await get<{ errorCount: number; requestsByStatus: Record<string, number> }>(h, cookie, '/api/monitor/summary');
    expect(summary.errorCount).toBeGreaterThanOrEqual(1);
    expect(summary.requestsByStatus.failed).toBeGreaterThanOrEqual(1);
  });

  it('M07: two simultaneous sessions keep stable ids, no duplicate rows, and survive a monitor reload', async () => {
    const before = await get<{ total: number }>(h, cookie, '/api/monitor/requests?limit=1');
    const [a, b] = await Promise.all([
      Promise.all([runTask(h, 'mock', 'ZH_TO_SV', 'simA'), runTask(h, 'mock', 'SV_TO_ZH', 'simA')]),
      Promise.all([runTask(h, 'mock', 'ZH_TO_SV', 'simB'), runTask(h, 'mock', 'SV_TO_ZH', 'simB')]),
    ]);
    const all = [...a, ...b];
    const after = await get<{ total: number }>(h, cookie, '/api/monitor/requests?limit=1');
    // mock: ZH->SV = ASR, INTERPRET, TRANSLATE, TTS (4); SV->ZH = ASR, TRANSLATE, TTS (3)
    expect(after.total - before.total).toBe(2 * (4 + 3));
    const rows = await get<{ rows: Array<{ rid: string; sessionId: string; taskId: string }> }>(h, cookie, '/api/monitor/requests?preset=mock&limit=200');
    expect(new Set(rows.rows.map((r) => r.rid)).size).toBe(rows.rows.length); // no duplicates
    for (const t of all) {
      const mine = rows.rows.filter((r) => r.taskId === t.taskId);
      expect(new Set(mine.map((r) => r.sessionId)).size).toBe(1);
    }
    expect(new Set(rows.rows.map((r) => r.sessionId))).toEqual(new Set(['simA', 'simB']));
    // "reload the monitor": new login, same data
    const fresh = (await login(h.baseUrl, PASSWORD, { 'X-Forwarded-For': '198.51.100.200' })).cookie;
    const again = await get<{ total: number }>(h, fresh, '/api/monitor/requests?limit=1');
    expect(again.total).toBe(after.total);
  });

  it('server-side filters, sorting and pagination work; invalid queries are 400 not 500', async () => {
    const page1 = await get<{ rows: Array<{ durationMs: number; stage: string }>; total: number; limit: number }>(h, cookie, '/api/monitor/requests?stage=ASR&limit=2&offset=0&sort=durationMs&order=desc');
    expect(page1.rows.length).toBeLessThanOrEqual(2);
    expect(page1.rows.every((r) => r.stage === 'ASR')).toBe(true);
    expect(page1.rows[0]!.durationMs).toBeGreaterThanOrEqual(page1.rows.at(-1)!.durationMs);
    const page2 = await get<{ rows: unknown[] }>(h, cookie, '/api/monitor/requests?stage=ASR&limit=2&offset=2&sort=durationMs&order=desc');
    expect(page2.rows.length).toBeGreaterThanOrEqual(0);
    for (const bad of ['?stage=NOPE', '?limit=0', '?limit=100000', '?from=yesterday', '?preset=gpu', '?sort=password&limit=5;DROP']) {
      const res = await fetch(`${h.baseUrl}/api/monitor/requests${bad}`, { headers: { Cookie: cookie } });
      expect(res.status, bad).toBe(400);
    }
    const injection = await fetch(`${h.baseUrl}/api/monitor/requests?model=${encodeURIComponent("x' OR '1'='1")}`, { headers: { Cookie: cookie } });
    expect(injection.status).toBe(200);
    expect(((await injection.json()) as { total: number }).total).toBe(0); // parameterised: no injection
    const ts = await get<Array<{ bucket: string; requests: number }>>(h, cookie, '/api/monitor/timeseries?bucket=hour');
    expect(ts.length).toBeGreaterThan(0);
    expect(ts.reduce((a, p) => a + p.requests, 0)).toBeGreaterThan(0);
  });

  it('health: local engine status is reported behind auth without private paths, cloud key never shown', async () => {
    const health = await get<{ local: { ready: boolean; status: string; asr: { modelTag: string }; tts: { modelTag: string } }; cloud: { configured: boolean } }>(h, cookie, '/api/monitor/health');
    expect(health.local.status).toBe('LOCAL_READY');
    expect(health.local.tts.modelTag).toContain('Tingting');
    const text = JSON.stringify(health);
    expect(text).not.toMatch(/\/Users\/|\/home\/|sk-[A-Za-z0-9]/);
    expect((await get<{ ready: boolean }>(h, cookie, '/api/local/health')).ready).toBe(true);
  });

  it('annotations: store a score for a task, reject unknown tasks and bad input, aggregate by preset', async () => {
    const task = await runTask(h, 'local', 'ZH_TO_SV', 'sessAnn');
    const save = (body: unknown) => fetch(`${h.baseUrl}/api/monitor/annotations`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await save({ taskId: task.taskId, meaningScore: 2, recipientUnderstood: 'yes', asrIssue: 'no', uiDifficultyCount: 1, referenceMeaningCode: 'Z01', note: 'adult test' })).status).toBe(204);
    expect((await save({ taskId: 'does-not-exist', meaningScore: 1 })).status).toBe(404);
    expect((await save({ taskId: task.taskId, meaningScore: 7 })).status).toBe(400);
    expect((await save({ taskId: task.taskId, transcript: 'not allowed' })).status).toBe(400); // strict: no content fields
    const stats = await get<{ groups: Array<{ preset: string; n: number; meanMeaning: number | null }> }>(h, cookie, '/api/monitor/annotations/stats');
    expect(stats.groups.find((g) => g.preset === 'local')).toMatchObject({ n: 1, meanMeaning: 2 });
  });

  it('budget: soft limit can be set, is reported, and never blocks requests', async () => {
    const set = await fetch(`${h.baseUrl}/api/monitor/settings`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: { enabled: true, limitUsd: 0.000001, scope: 'day' } }) });
    expect(set.status).toBe(200);
    const task = await runTask(h, 'cloud', 'ZH_TO_SV', 'sessBudget');
    expect(task.tts?.status).toBe(200); // alert only
    const summary = await get<{ budget: { exceeded: boolean; spentUsd: number } }>(h, cookie, '/api/monitor/summary');
    expect(summary.budget.exceeded).toBe(true);
    expect((await fetch(`${h.baseUrl}/api/monitor/settings`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: { enabled: true, limitUsd: -5, scope: 'day' } }) })).status).toBe(400);
    await fetch(`${h.baseUrl}/api/monitor/settings`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: { enabled: false, limitUsd: 5, scope: 'day' } }) });
  });
});

// ================================================================ M10 export + clearing, no content anywhere

describe('M10: export, clearing and content-free storage', () => {
  let h: Harness;
  let cookie = '';
  beforeAll(async () => {
    h = await boot();
    cookie = (await login(h.baseUrl)).cookie;
  });
  afterAll(() => stop(h));

  it('after real Cloud/Local/Mock tasks, NO table, CSV export or API response contains audio, transcripts, prompts or translations', async () => {
    await runTask(h, 'cloud', 'ZH_TO_SV', 'sx');
    await runTask(h, 'local', 'ZH_TO_SV', 'sx');
    await runTask(h, 'mock', 'ZH_TO_SV', 'sx');
    h.failTranslate.on = true;
    await runTask(h, 'cloud', 'SV_TO_ZH', 'sx'); // error message contains the sentinel upstream
    h.failTranslate.on = false;
    const annotated = (await get<{ rows: Array<{ taskId: string }> }>(h, cookie, '/api/monitor/tasks?limit=1')).rows[0]!.taskId;
    await fetch(`${h.baseUrl}/api/monitor/annotations`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: annotated, meaningScore: 1 }) });

    const sentinels = [SENTINEL_ZH, SENTINEL_SV, '我想去厕所', 'Jag vill gå', 'toaletten', 'transcript'];
    // 1) every row of every table
    const dump = JSON.stringify(
      ['sessions', 'tasks', 'segments', 'ai_requests', 'events', 'annotations', 'settings'].map((t) => [t, h.db.all(`SELECT * FROM ${t}`)]),
    );
    for (const s of sentinels) expect(dump, `db contains ${s}`).not.toContain(s);
    // 2) CSV exports
    for (const type of ['requests', 'tasks', 'annotations']) {
      const res = await fetch(`${h.baseUrl}/api/monitor/export?type=${type}&format=csv`, { headers: { Cookie: cookie } });
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
      expect(res.headers.get('content-disposition')).toMatch(/attachment/);
      const csv = await res.text();
      expect(csv.split('\n').length).toBeGreaterThan(1);
      for (const s of sentinels) expect(csv, `${type}.csv contains ${s}`).not.toContain(s);
    }
    // 3) every JSON API
    for (const route of ['/api/monitor/summary', '/api/monitor/requests?limit=200', '/api/monitor/tasks?limit=200', '/api/monitor/timeseries', '/api/monitor/health']) {
      const text = await (await fetch(`${h.baseUrl}${route}`, { headers: { Cookie: cookie } })).text();
      for (const s of sentinels) expect(text, `${route} contains ${s}`).not.toContain(s);
    }
    // 4) CSV is formula-injection safe
    const csv = await (await fetch(`${h.baseUrl}/api/monitor/export?type=requests&format=csv`, { headers: { Cookie: cookie } })).text();
    for (const line of csv.split('\n').slice(1)) expect(line).not.toMatch(/(^|,)[=+@]/);
  });

  it('clearing requires an explicit confirmation token, then removes every pilot row and the event log', async () => {
    const withoutConfirm = await fetch(`${h.baseUrl}/api/monitor/data`, { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    expect(withoutConfirm.status).toBe(400);
    expect(((await get<{ total: number }>(h, cookie, '/api/monitor/requests?limit=1')).total)).toBeGreaterThan(0);

    const cleared = await fetch(`${h.baseUrl}/api/monitor/data`, { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
    expect(cleared.status).toBe(204);
    for (const route of ['/api/monitor/requests?limit=1', '/api/monitor/tasks?limit=1', '/api/monitor/annotations?limit=1']) {
      expect((await get<{ total: number }>(h, cookie, route)).total, route).toBe(0);
    }
    const summary = await get<{ taskAttempts: number; requestCount: number; cost: { cloudKnownUsd: number } }>(h, cookie, '/api/monitor/summary');
    expect(summary).toMatchObject({ taskAttempts: 0, requestCount: 0 });
    // the dashboard still works on an empty database and new data accumulates again
    await runTask(h, 'mock', 'ZH_TO_SV', 'afterClear');
    expect((await get<{ total: number }>(h, cookie, '/api/monitor/requests?limit=1')).total).toBe(4);
  });
});

// ================================================================ Local failure modes over HTTP

describe('Local failures over HTTP never fall back to Cloud', () => {
  it('L07: with every local engine unreachable the call fails visibly (503/502-class, code LOCAL_*), is recorded as failed, and ONLY loopback was contacted', async () => {
    const h = await boot({}, 'down');
    try {
      const cookie = (await login(h.baseUrl)).cookie;
      const task = await runTask(h, 'local', 'ZH_TO_SV', 'sessDown');
      expect(task.asr.status).toBeGreaterThanOrEqual(500);
      const body = (await task.asr.json()) as { error: { category: string; code?: string } };
      expect(body.error.code).toBe('LOCAL_ASR_UNAVAILABLE');
      expect(JSON.stringify(body)).not.toMatch(/openai|api\.openai|sk-/i);
      const rows = await get<{ rows: Array<{ preset: string; status: string; errorCode: string | null; costUsd: number | null }> }>(h, cookie, '/api/monitor/requests?limit=50');
      expect(rows.rows.filter((r) => r.preset === 'cloud')).toHaveLength(0); // nothing silently rerouted to the paid provider
      expect(rows.rows.find((r) => r.preset === 'local')).toMatchObject({ status: 'failed', errorCode: 'LOCAL_ASR_UNAVAILABLE' });
      expect(h.localFetchLog.every((u) => /^http:\/\/127\.0\.0\.1:/.test(u))).toBe(true);
      const health = await get<{ local: { ready: boolean; status: string; lastError: { code: string } | null } }>(h, cookie, '/api/monitor/health');
      expect(health.local.ready).toBe(false);
      expect(health.local.lastError?.code).toBe('LOCAL_ASR_UNAVAILABLE');
    } finally {
      await stop(h);
    }
  });
});
