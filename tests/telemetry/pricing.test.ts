// Pricing + cost aggregation (docs/SYSTEM_DESIGN.md 6.4; acceptance M02/M03/M04).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PriceRegistry, type CostInput, type PriceData } from '../../apps/server/src/telemetry/pricing';
import { TelemetryDb, type NewRequest } from '../../apps/server/src/telemetry/db';
import * as q from '../../apps/server/src/telemetry/queries';

const DATA: PriceData = {
  revision: 'test-rev-1',
  effectiveDate: '2026-01-01',
  sourceUrl: 'https://example.invalid/pricing',
  entries: [
    { provider: 'openai', model: 'llm-x', stages: ['INTERPRET', 'TRANSLATE'], billingMetric: 'tokens', unit: 'USD / 1M tokens', inputPerMTok: 0.4, cachedInputPerMTok: 0.1, outputPerMTok: 1.6 },
    { provider: 'openai', model: 'asr-x', stages: ['ASR'], billingMetric: 'audio_minute', unit: 'USD / minute', perMinuteUsd: 0.006, costIsVendorEstimate: true },
    { provider: 'openai', model: 'tts-x', stages: ['TTS'], billingMetric: 'tokens', unit: 'USD / 1M tokens', inputPerMTok: 0.6, outputPerMTok: 12 },
    { provider: 'openai', model: 'ratless', stages: ['INTERPRET'], billingMetric: 'tokens', unit: 'USD / 1M tokens', inputPerMTok: null, outputPerMTok: null },
  ],
};

const cloud = (over: Partial<CostInput> & Pick<CostInput, 'model' | 'stage'>): CostInput => ({ preset: 'cloud', providerName: 'openai', usage: {}, ...over });

describe('PriceRegistry.calculate', () => {
  const prices = new PriceRegistry(DATA);

  it('M04: token usage -> reported_usage with the rate explanation and revision', () => {
    const r = prices.calculate(cloud({ model: 'llm-x', stage: 'INTERPRET', usage: { promptTokens: 1000, outputTokens: 200 } }));
    // (1000 * 0.4 + 200 * 1.6) / 1e6
    expect(r.costUsd).toBeCloseTo(0.00072, 10);
    expect(r.costBasis).toBe('reported_usage');
    expect(r.priceRevision).toBe('test-rev-1');
    expect(r.detail?.rates).toMatchObject({ inputPerMTok: 0.4, outputPerMTok: 1.6 });
    expect(r.detail?.quantities).toMatchObject({ promptTokens: 1000, outputTokens: 200 });
  });

  it('bills cached input tokens at the cached rate and never more than the prompt', () => {
    const r = prices.calculate(cloud({ model: 'llm-x', stage: 'TRANSLATE', usage: { promptTokens: 1000, cachedPromptTokens: 600, outputTokens: 0 } }));
    expect(r.costUsd).toBeCloseTo((400 * 0.4 + 600 * 0.1) / 1e6, 12);
    const clamped = prices.calculate(cloud({ model: 'llm-x', stage: 'TRANSLATE', usage: { promptTokens: 10, cachedPromptTokens: 999, outputTokens: 0 } }));
    expect(clamped.detail?.quantities).toMatchObject({ cachedPromptTokens: 10 });
  });

  it('matches dated model snapshots to their base price entry', () => {
    const r = prices.calculate(cloud({ model: 'llm-x-2025-04-14', stage: 'INTERPRET', usage: { promptTokens: 1, outputTokens: 1 } }));
    expect(r.costBasis).toBe('reported_usage');
  });

  it('M03: tokens missing from the provider -> unknown (null), NOT $0', () => {
    const r = prices.calculate(cloud({ model: 'llm-x', stage: 'INTERPRET', usage: {} }));
    expect(r.costUsd).toBeNull();
    expect(r.costBasis).toBe('unknown');
    expect(r.detail?.note).toMatch(/no token usage/);
    // Only one of the two token counts is also not enough to price.
    expect(prices.calculate(cloud({ model: 'llm-x', stage: 'INTERPRET', usage: { promptTokens: 5 } })).costUsd).toBeNull();
  });

  it('ASR is billed per audio minute and labelled as an estimate', () => {
    const r = prices.calculate(cloud({ model: 'asr-x', stage: 'ASR', usage: { inputAudioMs: 90_000 } }));
    expect(r.costUsd).toBeCloseTo(1.5 * 0.006, 12);
    expect(r.costBasis).toBe('estimated');
    expect(r.detail?.note).toMatch(/vendor/);
  });

  it('ASR without a known audio duration is unknown, not zero', () => {
    for (const usage of [{}, { inputAudioMs: 0 }]) {
      const r = prices.calculate(cloud({ model: 'asr-x', stage: 'ASR', usage }));
      expect(r.costUsd).toBeNull();
      expect(r.costBasis).toBe('unknown');
    }
  });

  it('TTS without reported usage is unknown (non-streaming endpoint returns none)', () => {
    const r = prices.calculate(cloud({ model: 'tts-x', stage: 'TTS', usage: { outputAudioMs: 2000 } }));
    expect(r.costUsd).toBeNull();
    expect(r.costBasis).toBe('unknown');
  });

  it('unknown model, missing rate and failed calls are all unknown with a reason', () => {
    expect(prices.calculate(cloud({ model: 'nope', stage: 'INTERPRET', usage: { promptTokens: 1, outputTokens: 1 } })).detail?.note).toMatch(/no price entry/);
    expect(prices.calculate(cloud({ model: 'ratless', stage: 'INTERPRET', usage: { promptTokens: 1, outputTokens: 1 } })).detail?.note).toMatch(/rate missing/);
    const failed = prices.calculate(cloud({ model: 'llm-x', stage: 'INTERPRET', usage: { promptTokens: 1, outputTokens: 1 }, priceable: false }));
    expect(failed.costUsd).toBeNull();
    expect(failed.costBasis).toBe('unknown');
  });

  it('a stage the entry does not list is not priced with that entry', () => {
    expect(prices.calculate(cloud({ model: 'asr-x', stage: 'TRANSLATE', usage: { promptTokens: 1, outputTokens: 1 } })).costBasis).toBe('unknown');
  });

  it('local = true $0 external cost (not_applicable); mock = N/A (null)', () => {
    const local = prices.calculate({ preset: 'local', providerName: 'local', model: 'ollama:qwen3:8b', stage: 'INTERPRET', usage: { promptTokens: 9999, outputTokens: 9999 } });
    expect(local.costUsd).toBe(0);
    expect(local.costBasis).toBe('not_applicable');
    expect(local.detail?.note).toMatch(/hardware/);
    const mock = prices.calculate({ preset: 'mock', providerName: 'mock', model: 'mock', stage: 'TTS', usage: {} });
    expect(mock.costUsd).toBeNull();
    expect(mock.costBasis).toBe('not_applicable');
  });
});

describe('PriceRegistry file handling', () => {
  it('hot-reloads edited rates and falls back to an EMPTY registry (all unknown) on a broken file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-prices-'));
    const file = path.join(dir, 'prices.json');
    try {
      fs.writeFileSync(file, JSON.stringify(DATA));
      const reg = PriceRegistry.fromFile(file);
      const input = cloud({ model: 'llm-x', stage: 'INTERPRET', usage: { promptTokens: 1_000_000, outputTokens: 0 } });
      expect(reg.calculate(input).costUsd).toBeCloseTo(0.4, 10);
      expect(reg.describe().revision).toBe('test-rev-1');

      const edited = { ...DATA, revision: 'test-rev-2', entries: DATA.entries.map((e) => (e.model === 'llm-x' ? { ...e, inputPerMTok: 1 } : e)) };
      fs.writeFileSync(file, JSON.stringify(edited));
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // make sure the mtime differs
      const after = reg.calculate(input);
      expect(after.costUsd).toBeCloseTo(1, 10);
      expect(after.priceRevision).toBe('test-rev-2');

      expect(PriceRegistry.fromFile(path.join(dir, 'missing.json')).calculate(input).costBasis).toBe('unknown');
      fs.writeFileSync(file, '{ not json');
      expect(PriceRegistry.fromFile(file).calculate(input).costUsd).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the shipped apps/server/config/prices.json parses and prices the configured Cloud models', () => {
    const reg = PriceRegistry.fromFile(path.resolve(__dirname, '../../apps/server/config/prices.json'));
    expect(reg.revision).not.toBe('none');
    const llm = reg.calculate(cloud({ model: 'gpt-4.1-mini', stage: 'INTERPRET', usage: { promptTokens: 485, cachedPromptTokens: 0, outputTokens: 28 } }));
    expect(llm.costBasis).toBe('reported_usage');
    expect(llm.costUsd).toBeCloseTo((485 * 0.4 + 28 * 1.6) / 1e6, 12);
    expect(reg.calculate(cloud({ model: 'gpt-4o-transcribe', stage: 'ASR', usage: { inputAudioMs: 60_000 } })).costUsd).toBeCloseTo(0.006, 10);
    const luna = reg.calculate(cloud({ model: 'gpt-6-luna', stage: 'TRANSLATE', usage: { promptTokens: 485, cachedPromptTokens: 0, outputTokens: 28 } }));
    expect(luna.costUsd).toBeCloseTo((485 * 0.1 + 28 * 0.5) / 1e6, 12);
    const identify = reg.calculate(cloud({ model: 'gpt-6-luna', stage: 'IDENTIFY', usage: { promptTokens: 800, cachedPromptTokens: 0, outputTokens: 40 } }));
    expect(identify.costUsd).toBeCloseTo((800 * 0.1 + 40 * 0.5) / 1e6, 12);
    expect(reg.calculate(cloud({ model: 'gpt-transcribe', stage: 'ASR', usage: { inputAudioMs: 60_000 } })).costUsd).toBeCloseTo(0.0045, 10);
    const realtime = reg.calculate(cloud({
      model: 'gpt-realtime-2.1-mini',
      stage: 'TTS',
      usage: {
        promptTokens: 120,
        outputTokens: 210,
        inputTextTokens: 100,
        inputAudioTokens: 20,
        inputImageTokens: 0,
        cachedTextTokens: 40,
        cachedAudioTokens: 5,
        outputTextTokens: 10,
        outputAudioTokens: 200,
      },
    }));
    // (60*0.6 + 40*0.06) + (15*10 + 5*0.3) + 10*2.4 + 200*20
    expect(realtime.costUsd).toBeCloseTo((36 + 2.4 + 150 + 1.5 + 24 + 4000) / 1e6, 12);
    expect(realtime.costBasis).toBe('reported_usage');
    expect(reg.calculate(cloud({ model: 'gpt-realtime-2.1-mini', stage: 'TTS', usage: { promptTokens: 10, outputTokens: 10 } })).costUsd).toBeNull();
    expect(reg.calculate(cloud({ model: 'gpt-4o-mini-tts', stage: 'TTS', usage: { promptTokens: 100, outputTokens: 50 } })).costUsd).toBeCloseTo((100 * 0.6 + 50 * 12) / 1e6, 12);
    expect(reg.describe().editableOnlyOnServer).toBe(true);
  });
});

// ---- aggregation over stored rows (M02: retries, partial totals)

let seq = 0;
function row(over: Partial<NewRequest> & Pick<NewRequest, 'taskId' | 'stage'>): NewRequest {
  const n = ++seq;
  return {
    requestId: `req${n}`,
    sessionId: 's1',
    segmentId: null,
    startedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, n)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, n)).toISOString(),
    preset: 'cloud',
    direction: 'ZH_TO_SV',
    providerName: 'openai',
    modelTag: 'llm-x',
    durationMs: 100,
    engineInferenceMs: null,
    conversionMs: null,
    modelLoadMs: null,
    inputAudioMs: null,
    outputAudioMs: null,
    promptTokens: null,
    outputTokens: null,
    cachedPromptTokens: null,
    status: 'succeeded',
    errorCode: null,
    costUsd: null,
    costBasis: 'unknown',
    priceRevision: 'test-rev-1',
    costDetail: null,
    ...over,
  };
}

describe('cost aggregation (M02/M03)', () => {
  it('M02: ASR 2x + INTERPRET 2x + TTS 2x = six request rows, ONE task row; task cost sums every call incl. failed retries', () => {
    const db = new TelemetryDb(':memory:');
    const prices = new PriceRegistry(DATA);
    const usage = { promptTokens: 1000, outputTokens: 100 };
    const priced = (stage: 'INTERPRET', status: 'succeeded' | 'failed') => {
      const c = prices.calculate(cloud({ model: 'llm-x', stage, usage, priceable: status === 'succeeded' }));
      return { costUsd: c.costUsd, costBasis: c.costBasis };
    };
    // ASR twice (priced by minute), INTERPRET twice (first failed -> retry), TTS twice (unknown)
    for (let i = 0; i < 2; i++) {
      const c = prices.calculate(cloud({ model: 'asr-x', stage: 'ASR', usage: { inputAudioMs: 6000 } }));
      db.recordRequest(row({ taskId: 'T', stage: 'ASR', modelTag: 'asr-x', inputAudioMs: 6000, costUsd: c.costUsd, costBasis: c.costBasis }));
    }
    db.recordRequest(row({ taskId: 'T', stage: 'INTERPRET', status: 'failed', errorCode: 'SERVER', ...priced('INTERPRET', 'failed') }));
    db.recordRequest(row({ taskId: 'T', stage: 'INTERPRET', promptTokens: 1000, outputTokens: 100, ...priced('INTERPRET', 'succeeded') }));
    db.recordRequest(row({ taskId: 'T', stage: 'TTS', modelTag: 'tts-x' }));
    db.recordRequest(row({ taskId: 'T', stage: 'TTS', modelTag: 'tts-x' }));

    const requests = q.listRequests(db, {}, { limit: 50, offset: 0 });
    expect(requests.total).toBe(6);
    const tasks = q.listTasks(db, {}, { limit: 50, offset: 0 });
    expect(tasks.total).toBe(1);
    const task = tasks.rows[0]!;
    expect(task.requestCount).toBe(6);
    expect(task.asrCalls).toBe(2);
    expect(task.interpretCalls).toBe(2);
    expect(task.ttsCalls).toBe(2);
    expect(task.failedRequests).toBe(1);
    // known = 2 ASR estimates + 1 successful interpret; unknown = failed interpret + 2 TTS
    expect(task.costKnownUsd).toBeCloseTo(2 * 0.1 * 0.006 + (1000 * 0.4 + 100 * 1.6) / 1e6, 10);
    expect(task.costUnknownRequests).toBe(3);

    const retry = requests.rows.find((r) => r.stage === 'INTERPRET' && r.status === 'succeeded');
    expect(retry?.retryOfRid).toMatch(/:INTERPRET:/);
  });

  it('M03: partial totals - unknown requests are reported beside the subtotal and never counted as $0', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(row({ taskId: 'T', stage: 'INTERPRET', costUsd: 0.5, costBasis: 'reported_usage', promptTokens: 1, outputTokens: 1 }));
    db.recordRequest(row({ taskId: 'T', stage: 'TTS', modelTag: 'tts-x' })); // unknown
    db.recordRequest(row({ taskId: 'T', stage: 'ASR', modelTag: 'asr-x', costUsd: 0.25, costBasis: 'estimated' }));
    const s = q.summary(db, {});
    expect(s.cost.cloudKnownUsd).toBeCloseTo(0.75, 10);
    expect(s.cost.cloudEstimatedUsd).toBeCloseTo(0.25, 10);
    expect(s.cost.cloudUnknownRequests).toBe(1);
    expect(s.cost.cloudRequests).toBe(3);
    expect(s.cost.partial).toBe(true);
    const tts = s.models.find((m) => m.stage === 'TTS');
    expect(tts?.costUnknownRequests).toBe(1);
    expect(tts?.costKnownUsd).toBe(0);
  });

  it('local requests never add to Cloud cost and mock rows do not distort latency statistics', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(row({ taskId: 'L', stage: 'TRANSLATE', preset: 'local', providerName: 'local', costUsd: 0, costBasis: 'not_applicable', durationMs: 1000 }));
    db.recordRequest(row({ taskId: 'M', stage: 'TRANSLATE', preset: 'mock', providerName: 'mock', costBasis: 'not_applicable', durationMs: 1 }));
    const s = q.summary(db, {});
    expect(s.cost.cloudRequests).toBe(0);
    expect(s.cost.cloudKnownUsd).toBe(0);
    expect(s.requestCount).toBe(2);
    expect(s.requestLatency.count).toBe(1);
    expect(s.requestLatency.avgMs).toBe(1000);
    expect(q.summary(db, { preset: 'mock' }).requestLatency.avgMs).toBe(1);
  });
});
