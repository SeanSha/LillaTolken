// End-to-end over REAL HTTP: Express app (mock registry) <-> web ApiClient <-> the ONE machine.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createActor, waitFor } from 'xstate';
import { AppError } from '@kt/shared';
import { createApp } from '../../apps/server/src/app';
import { loadConfig } from '../../apps/server/src/config';
import { EventStore } from '../../apps/server/src/evaluation/eventStore';
import { createRegistry } from '../../apps/server/src/providers/registry';
import { AudioStore } from '../../apps/web/src/audio/audioStore';
import { ScriptedRecorder } from '../../apps/web/src/audio/recorder';
import { createDialogueMachine } from '../../apps/web/src/dialogue/machine';
import { createApiBundle } from '../../apps/web/src/services/apiClient';
import { EventLogger } from '../../apps/web/src/services/eventLogger';
import { ListSource } from '../machine/harness';

let server: Server;
let baseUrl = '';
let store: EventStore;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // No key -> cloud unavailable; local disabled -> deterministic regardless of this machine's engines;
  // in-memory telemetry DB and a fixed admin password -> the test never touches real files.
  const config = loadConfig({
    PERSIST_EVENTS: 'off',
    LOCAL_ENABLED: 'off',
    MONITOR_DB_PATH: ':memory:',
    MONITOR_ADMIN_PASSWORD: 'test-admin-password',
  } as NodeJS.ProcessEnv);
  const registry = createRegistry(config);
  store = new EventStore();
  const { app } = createApp({ config, registry, events: store });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ids = { 'X-Task-Id': 't1', 'X-Request-Id': 'r1', 'X-Provider-Preset': 'mock' };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ids, ...headers },
    body: JSON.stringify(body),
  });

function makeMachine(utterances: string[], logger: EventLogger) {
  const audioStore = new AudioStore();
  let n = 0;
  const machine = createDialogueMachine({
    providers: (preset) => createApiBundle(preset, { baseUrl }),
    recorder: new ScriptedRecorder(new ListSource(utterances)),
    audioStore,
    speakPrompt: async () => undefined,
    stopSpeaking: () => undefined,
    stopPlayback: () => undefined,
    log: logger.log,
    newId: () => `e2e${++n}`,
    now: () => Date.now(),
  });
  const actor = createActor(machine, { input: { sessionId: 'e2e-session', preset: 'mock' } });
  actor.start();
  const until = (path: string) => waitFor(actor, (s) => s.matches(path as never), { timeout: 5000 });
  return { actor, until, audioStore };
}

describe('HTTP API', () => {
  it('GET /api/health reports presets without leaking secrets', async () => {
    const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as {
      presets: Record<string, { available: boolean }>;
    };
    expect(body.presets.mock?.available).toBe(true);
    expect(body.presets.cloud?.available).toBe(false); // no OPENAI_API_KEY in this test
    expect(body.presets.local?.available).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/sk-|apiKey/i);
  });

  it('cloud and local presets fail cleanly (501) instead of silently falling back', async () => {
    for (const preset of ['cloud', 'local']) {
      const res = await post('/api/translate', { text: '我想去厕所。', direction: 'ZH_TO_SV' }, { 'X-Provider-Preset': preset });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { category: string; code?: string } };
      expect(body.error.category).toBe('NOT_CONFIGURED');
      if (preset === 'local') expect(body.error.code).toBe('LOCAL_DISABLED'); // sanitized code, never a cloud fallback
    }
  });

  it('validates input: bad preset, bad ids, oversized text, unknown fields', async () => {
    expect((await post('/api/translate', { text: 'x', direction: 'ZH_TO_SV' }, { 'X-Provider-Preset': 'nope' })).status).toBe(400);
    expect((await post('/api/translate', { text: 'x', direction: 'ZH_TO_SV' }, { 'X-Task-Id': 'bad id!' })).status).toBe(400);
    expect((await post('/api/translate', { text: 'x'.repeat(5000), direction: 'ZH_TO_SV' })).status).toBe(400);
    expect((await post('/api/tts', { text: '', language: 'zh' })).status).toBe(400);
    const badJson = await fetch(`${baseUrl}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ids }, body: '{nope' });
    expect(badJson.status).toBe(400);
  });

  it('ASR requires audio bytes and a valid language', async () => {
    const empty = await fetch(`${baseUrl}/api/asr?language=zh`, { method: 'POST', headers: { ...ids, 'Content-Type': 'audio/mp4' }, body: new Uint8Array(0) });
    expect(empty.status).toBe(400);
    const badLang = await fetch(`${baseUrl}/api/asr?language=en`, { method: 'POST', headers: { ...ids, 'Content-Type': 'audio/mp4' }, body: new Uint8Array([1, 2]) });
    expect(badLang.status).toBe(400);
  });

  it('interpret / translate / tts return contract-shaped responses (mock)', async () => {
    const interp = await post('/api/interpret', { dialogueInputs: [{ purpose: 'INITIAL', textParts: ['他拿走了我的那个。'] }], remainingClarifications: 3 });
    expect(await interp.json()).toMatchObject({ kind: 'ASK_CLARIFICATION' });

    const noBudget = await post('/api/interpret', { dialogueInputs: [{ purpose: 'INITIAL', textParts: ['他拿走了我的那个。'] }], remainingClarifications: 0 });
    expect(await noBudget.json()).toMatchObject({ kind: 'UNRESOLVED' });

    const tr = await post('/api/translate', { text: 'Lägg boken på bordet.', direction: 'SV_TO_ZH' });
    expect(await tr.json()).toEqual({ translation: '把书放在桌子上。' });

    const tts = await post('/api/tts', { text: '你好', language: 'zh' });
    expect(tts.headers.get('content-type')).toBe('audio/wav');
    const bytes = new Uint8Array(await tts.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
  });
});

describe('Evaluation events: metadata only', () => {
  it('rejects any content-bearing field (strict schema)', async () => {
    const ok = {
      ts: new Date().toISOString(),
      sessionId: 's',
      providerPreset: 'mock',
      version: '0.1.0',
      eventType: 'TASK_STARTED',
    };
    expect((await post('/api/events', { events: [ok] })).status).toBe(204);
    expect((await post('/api/events', { events: [{ ...ok, transcript: '我想去厕所' }] })).status).toBe(400);
    expect((await post('/api/events', { events: [{ ...ok, translation: 'Jag vill' }] })).status).toBe(400);
    expect((await post('/api/events', { events: [{ ...ok, eventType: 'MADE_UP' }] })).status).toBe(400);
  });
});

describe('Full Mock workflow through HTTP (real machine, real API client)', () => {
  it('ZH→SV with clarification: ASR → question → answer → confirm → Swedish + audio → delivered; CSV has no content', async () => {
    store.clear();
    const logger = new EventLogger({ baseUrl, flushMs: 5, getScenarioId: () => 'E2E-T04' });
    const { actor, until, audioStore } = makeMachine(['他拿走了我的那个。', '水壶。'], logger);

    actor.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await until('task.recording.listening');
    actor.send({ type: 'STOP_SEGMENT' });
    await until('task.segmentDecision');
    actor.send({ type: 'FINISH_INPUT' });
    await until('task.clarifying.asking');
    expect(actor.getSnapshot().context.task?.clarificationCount).toBe(1);
    expect(audioStore.getPlayback('prompt')?.mimeType).toBe('audio/wav'); // real TTS response arrived

    actor.send({ type: 'START_ANSWER' });
    await until('task.recording.listening');
    actor.send({ type: 'STOP_SEGMENT' });
    await until('task.segmentDecision');
    actor.send({ type: 'FINISH_INPUT' });
    await until('task.confirming.asking');
    expect(actor.getSnapshot().context.task?.proposedMeaning).toBe('他拿走了我的水壶。');

    actor.send({ type: 'CONFIRM_YES' });
    await until('task.result.pending');
    expect(actor.getSnapshot().context.task?.translatedText).toBe('Han tog min vattenflaska.');
    actor.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
    await until('task.result.delivered');
    expect(actor.getSnapshot().context.lastDelivered?.translation).toBe('Han tog min vattenflaska.');

    await logger.flush();
    // The developer export is admin-only since v1.2 (M09): anonymous access is refused.
    expect((await fetch(`${baseUrl}/api/events/export`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/events`, { method: 'DELETE' })).status).toBe(401);
    const login = await fetch(`${baseUrl}/api/monitor/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-admin-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const csv = await (await fetch(`${baseUrl}/api/events/export`, { headers: { Cookie: cookie } })).text();
    const header = csv.split('\n')[0] ?? '';
    expect(header).toContain('eventType');
    for (const type of ['TASK_STARTED', 'RECORDING_STARTED', 'ASR_COMPLETED', 'CLARIFICATION_PRESENTED', 'CONFIRMATION_YES', 'TRANSLATION_READY', 'TTS_READY', 'PLAYBACK_COMPLETED', 'TASK_COMPLETED']) {
      expect(csv, type).toContain(type);
    }
    expect(csv).toContain('E2E-T04');
    for (const secret of ['水壶', '那个', 'vattenflaska', '你是说']) {
      expect(csv).not.toContain(secret);
    }
  });

  it('SV→ZH: recognised Swedish + Chinese translation + Chinese audio', async () => {
    const logger = new EventLogger({ baseUrl, flushMs: 5 });
    const { actor, until, audioStore } = makeMachine(['Lägg boken på bordet.'], logger);
    actor.send({ type: 'START_TASK', direction: 'SV_TO_ZH' });
    await until('task.recording.listening');
    actor.send({ type: 'STOP_SEGMENT' });
    await until('task.segmentDecision');
    actor.send({ type: 'FINISH_INPUT' });
    await until('task.result.pending');
    const task = actor.getSnapshot().context.task;
    expect(task?.sourceText).toBe('Lägg boken på bordet.');
    expect(task?.translatedText).toBe('把书放在桌子上。');
    expect(audioStore.getPlayback('result')).not.toBeNull();
  });

  it('mock network error marker surfaces as a recoverable NETWORK error over HTTP and RETRY recovers', async () => {
    const logger = new EventLogger({ baseUrl, flushMs: 5 });
    const { actor, until } = makeMachine(['[NETWORK_ERROR]我想去厕所。'], logger);
    actor.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await until('task.recording.listening');
    actor.send({ type: 'STOP_SEGMENT' });
    await until('task.segmentDecision');
    actor.send({ type: 'FINISH_INPUT' });
    await until('task.recoverableError');
    expect(actor.getSnapshot().context.error).toEqual({ stage: 'asr', category: 'NETWORK' });
    actor.send({ type: 'RETRY' });
    await until('task.confirming.asking');
  });

  it('client maps an unreachable server to a NETWORK AppError', async () => {
    const bundle = createApiBundle('mock', { baseUrl: 'http://127.0.0.1:1' });
    await expect(bundle.dialogue.translate({ text: 'x', direction: 'ZH_TO_SV' }, { taskId: 't', requestId: 'r' })).rejects.toMatchObject({
      category: 'NETWORK',
    });
    expect(new AppError('NETWORK').category).toBe('NETWORK');
  });
});
