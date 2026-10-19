// npm run local:e2e -- [--url http://127.0.0.1:8787] [--preset local|mock] [--rounds 1]
// Drives the REAL running backend over HTTP exactly like the iPhone client does (ASR -> interpret ->
// translate -> TTS, with the X-* headers and metadata events), using SYNTHETIC speech made by the
// Mac's own `say`. It exercises the full server path incl. telemetry, so the /monitor dashboard has
// real rows to show. It is NOT an adult-speech test and never calls Cloud (preset cloud is refused).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadConfig, loadDotenv } from '../src/config';

const run = promisify(execFile);
loadDotenv();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const url = arg('url', `http://127.0.0.1:${loadConfig().port}`);
const preset = arg('preset', 'local');
const rounds = Math.max(1, Number(arg('rounds', '1')));
const allowCloud = process.argv.includes('--allow-cloud');
if (preset === 'cloud' && !allowCloud) {
  console.error('Refusing: preset cloud makes PAID OpenAI calls. Re-run with --allow-cloud to confirm (synthetic speech only, a fraction of a cent per task).');
  process.exit(2);
}
const session = `e2e-${Date.now().toString(36)}`;
let seq = 0;
const id = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

type Json = Record<string, unknown>;

async function api<T>(route: string, init: RequestInit & { headers?: Record<string, string> }, headers: Record<string, string>): Promise<{ status: number; body: T; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${url}${route}`, { ...init, headers: { ...headers, ...init.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = (ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())) as T;
  return { status: res.status, body, ms: Math.round(performance.now() - started) };
}

async function say(voice: string, text: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-e2e-'));
  try {
    const file = path.join(dir, 'in.wav');
    await run('say', ['-v', voice, '-o', file, '--data-format=LEI16@16000', text]);
    return await fs.readFile(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const wavMs = (b: Buffer) => Math.round(((b.length - 44) / 2 / 16000) * 1000);

async function emit(events: Json[]): Promise<void> {
  const res = await fetch(`${url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
  if (res.status !== 204) throw new Error(`/api/events -> ${res.status}`);
}

type Case = { direction: 'ZH_TO_SV' | 'SV_TO_ZH'; voice: string; spoken: string; scenario: string; expect: RegExp };
const CASES: Case[] = [
  { direction: 'ZH_TO_SV', voice: 'Tingting', spoken: '我想去厕所。', scenario: 'SYNTH-ZH-01', expect: /toalett|toa/i },
  { direction: 'ZH_TO_SV', voice: 'Tingting', spoken: '我肚子饿了，我想吃饭。', scenario: 'SYNTH-ZH-02', expect: /hungrig|mat|äta/i },
  { direction: 'SV_TO_ZH', voice: 'Alva', spoken: 'Jag vill gå hem nu.', scenario: 'SYNTH-SV-01', expect: /回家|回去/ },
  { direction: 'SV_TO_ZH', voice: 'Alva', spoken: 'Kan jag få lite vatten?', scenario: 'SYNTH-SV-02', expect: /水/ },
];

let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL ${m}`);
};

async function runCase(c: Case): Promise<void> {
  const taskId = id('task');
  const sourceLang = c.direction === 'ZH_TO_SV' ? 'zh' : 'sv';
  const targetLang = sourceLang === 'zh' ? 'sv' : 'zh';
  const h = (requestId: string): Record<string, string> => ({ 'X-Provider-Preset': preset, 'X-Task-Id': taskId, 'X-Request-Id': requestId, 'X-Session-Id': session, 'X-Direction': c.direction });
  const t0 = Date.now();
  const ev = (eventType: string, extra: Json = {}): Json => ({ ts: new Date().toISOString(), sessionId: session, taskId, scenarioId: c.scenario, providerPreset: preset, version: 'e2e', direction: c.direction, eventType, elapsedMs: Date.now() - t0, ...extra });
  console.log(`\n[${c.scenario}] ${c.direction} via ${preset}  (synthetic speech: "${c.spoken}")`);

  const audio = await say(c.voice, c.spoken);
  const segmentId = id('seg');
  const events: Json[] = [ev('TASK_STARTED'), ev('RECORDING_STARTED', { segmentId, inputPurpose: 'INITIAL', segmentIndex: 0 }), ev('RECORDING_STOPPED', { segmentId, inputPurpose: 'INITIAL', segmentIndex: 0, segmentDurationMs: wavMs(audio) })];

  const asrId = id('req');
  const asr = await api<{ text: string; error?: unknown }>(`/api/asr?language=${sourceLang}`, { method: 'POST', body: new Uint8Array(audio), headers: { 'Content-Type': 'audio/wav', 'X-Duration-Ms': String(wavMs(audio)), ...(preset === 'mock' ? { 'X-Mock-Transcript': encodeURIComponent(c.spoken) } : {}) } }, h(asrId));
  if (asr.status !== 200) {
    fail(`ASR HTTP ${asr.status} ${JSON.stringify(asr.body)}`);
    events.push(ev('ERROR', { stage: 'asr', errorCategory: 'ASR' }), ev('TASK_CANCELLED'));
    await emit(events);
    return;
  }
  console.log(`  ASR   ${asr.ms}ms  -> "${asr.body.text}"`);
  events.push(ev('ASR_COMPLETED', { stage: 'asr', stageDurationMs: asr.ms }), ev('INPUT_FINISHED'));

  let sourceText = asr.body.text;
  if (c.direction === 'ZH_TO_SV') {
    const it = await api<{ kind: string; meaningZh?: string; questionZh?: string }>('/api/interpret', { method: 'POST', body: JSON.stringify({ dialogueInputs: [{ purpose: 'INITIAL', textParts: [asr.body.text] }], remainingClarifications: 3 }), headers: { 'Content-Type': 'application/json' } }, h(id('req')));
    if (it.status !== 200) {
      fail(`interpret HTTP ${it.status}`);
      events.push(ev('ERROR', { stage: 'interpret', errorCategory: 'LLM' }), ev('TASK_CANCELLED'));
      await emit(events);
      return;
    }
    console.log(`  LLM   ${it.ms}ms  -> ${it.body.kind}`);
    events.push(ev('INTERPRETATION_READY', { stage: 'interpret', stageDurationMs: it.ms }));
    if (it.body.kind === 'ASK_CLARIFICATION') {
      // Synthetic run has no second utterance: record it as clarification needed, then cancel.
      events.push(ev('CLARIFICATION_PRESENTED', { clarificationCount: 1 }), ev('TASK_CANCELLED'));
      await emit(events);
      console.log('  (model asked a clarification; synthetic script stops here)');
      return;
    }
    sourceText = it.body.meaningZh ?? asr.body.text;
    events.push(ev('CONFIRMATION_YES'));
  }

  const tr = await api<{ translation: string }>('/api/translate', { method: 'POST', body: JSON.stringify({ text: sourceText, direction: c.direction }), headers: { 'Content-Type': 'application/json' } }, h(id('req')));
  if (tr.status !== 200) {
    fail(`translate HTTP ${tr.status}`);
    events.push(ev('ERROR', { stage: 'translate', errorCategory: 'LLM' }), ev('TASK_CANCELLED'));
    await emit(events);
    return;
  }
  console.log(`  TRANS ${tr.ms}ms  -> "${tr.body.translation}"`);
  if (preset === 'local' && !c.expect.test(tr.body.translation)) fail(`translation did not contain the expected meaning (${c.expect})`);
  events.push(ev('TRANSLATION_READY', { stage: 'translate', stageDurationMs: tr.ms }));

  const tts = await api<Buffer>('/api/tts', { method: 'POST', body: JSON.stringify({ text: tr.body.translation, language: targetLang }), headers: { 'Content-Type': 'application/json' } }, h(id('req')));
  if (tts.status !== 200 || !Buffer.isBuffer(tts.body) || tts.body.length < 1000) {
    fail(`tts HTTP ${tts.status}`);
    events.push(ev('ERROR', { stage: 'tts', errorCategory: 'TTS' }), ev('TASK_CANCELLED'));
    await emit(events);
    return;
  }
  console.log(`  TTS   ${tts.ms}ms  -> ${tts.body.length} bytes`);
  events.push(ev('TTS_READY', { stage: 'tts', stageDurationMs: tts.ms }), ev('PLAYBACK_COMPLETED', { deliveryMode: 'audio', playbackMs: preset === 'local' ? wavMs(tts.body) : undefined }), ev('TASK_COMPLETED', { deliveryMode: 'audio' }));
  await emit(events);
}

console.log(`E2E over HTTP -> ${url}  preset=${preset}  rounds=${rounds}`);
const health = (await (await fetch(`${url}/api/health`)).json()) as { presets: Record<string, { available: boolean; modelTag: string }> };
console.log(`models: ${health.presets[preset]?.modelTag}`);
const selected = preset === 'cloud' ? [CASES[0]!, CASES[2]!] : CASES; // one task per direction for Cloud
for (let r = 0; r < rounds; r++) for (const c of selected) await runCase(c);
console.log(failures === 0 ? '\nPASS (plumbing over HTTP, synthetic speech only - NOT an adult-speech verification).' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
