// The ONE telemetry wrapper: one row per invocation, around success, exceptions, cancel and timeout
// (docs/SYSTEM_DESIGN.md 6.4; acceptance M05/M08).
import { describe, expect, it, vi } from 'vitest';
import { AppError, type AiStage, type ProviderBundle, type RequestMeta } from '@kt/shared';
import { observeBundle, inferDirection } from '../../apps/server/src/telemetry/observe';
import { PriceRegistry, type PriceData } from '../../apps/server/src/telemetry/pricing';
import { TelemetryDb } from '../../apps/server/src/telemetry/db';
import * as q from '../../apps/server/src/telemetry/queries';

const PRICES: PriceData = {
  revision: 'r1',
  effectiveDate: '2026-01-01',
  sourceUrl: '',
  entries: [{ provider: 'openai', model: 'llm', stages: ['INTERPRET', 'TRANSLATE'], billingMetric: 'tokens', unit: 'u', inputPerMTok: 1, outputPerMTok: 2 }],
};

const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav', durationMs: 4000 };

type Behaviour = Partial<Record<AiStage, (meta: RequestMeta) => Promise<unknown> | unknown>>;

function bundleOf(b: Behaviour): ProviderBundle {
  const call = async (stage: AiStage, meta: RequestMeta, fallback: unknown) => (b[stage] ? b[stage]!(meta) : fallback);
  return {
    asr: { transcribe: (_a, _l, meta) => call('ASR', meta, 'text') as Promise<string> },
    dialogue: {
      interpretChinese: (_i, meta) => call('INTERPRET', meta, { kind: 'PROPOSE_MEANING', meaningZh: 'x' }) as never,
      translate: (_i, meta) => call('TRANSLATE', meta, 'y') as Promise<string>,
    },
    tts: { synthesize: (_t, _l, meta) => call('TTS', meta, { bytes: new Uint8Array([0]), mimeType: 'audio/wav', durationMs: 1500 }) as never },
  };
}

function setup(b: Behaviour, preset: 'cloud' | 'local' | 'mock' = 'cloud', db: TelemetryDb | null = new TelemetryDb(':memory:')) {
  let clock = 0;
  const observed = observeBundle(bundleOf(b), {
    db,
    prices: new PriceRegistry(PRICES),
    preset,
    providerName: preset === 'cloud' ? 'openai' : preset,
    modelFor: (stage) => (stage === 'INTERPRET' || stage === 'TRANSLATE' ? 'llm' : `${stage}-model`),
    now: () => (clock += 25),
  });
  return { observed, db };
}

const meta = (over: Partial<RequestMeta> = {}): RequestMeta => ({ taskId: 'task1', requestId: 'req1', sessionId: 'sess1', ...over });
const rows = (db: TelemetryDb) => q.listRequests(db, {}, { limit: 100, offset: 0, sort: 'startedAt', order: 'asc' }).rows;

describe('observeBundle', () => {
  it('writes exactly ONE row per invocation with stage, model, duration and direction', async () => {
    const { observed, db } = setup({});
    await observed.asr.transcribe(audio, 'zh', meta());
    await observed.dialogue.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['a'] }], remainingClarifications: 3 }, meta({ requestId: 'req2' }));
    await observed.dialogue.translate({ text: 'a', direction: 'SV_TO_ZH' }, meta({ requestId: 'req3' }));
    await observed.tts.synthesize('a', 'sv', meta({ requestId: 'req4' }));
    const r = rows(db!);
    expect(r.map((x) => x.stage)).toEqual(['ASR', 'INTERPRET', 'TRANSLATE', 'TTS']);
    expect(r.every((x) => x.status === 'succeeded' && x.durationMs > 0)).toBe(true);
    // TTS direction is ambiguous on its own (null) and is displayed from the task's direction.
    expect(r.map((x) => x.direction)).toEqual(['ZH_TO_SV', 'ZH_TO_SV', 'SV_TO_ZH', 'ZH_TO_SV']);
    expect(r[0]!.inputAudioMs).toBe(4000); // known from the uploaded audio even if the engine reports nothing
    expect(r[3]!.outputAudioMs).toBe(1500); // generated media length, distinct from latency
    expect(r.every((x) => x.sessionId === 'sess1')).toBe(true);
    expect(q.listTasks(db!, {}, { limit: 10, offset: 0 }).total).toBe(1);
  });

  it('records usage reported through meta.report and prices it (M04); no usage -> unknown (M03)', async () => {
    const { observed, db } = setup({
      INTERPRET: (m) => {
        m.report?.({ promptTokens: 1_000_000, outputTokens: 500_000 });
        return { kind: 'PROPOSE_MEANING', meaningZh: 'x' };
      },
      TRANSLATE: () => 'silent provider',
    });
    await observed.dialogue.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['a'] }], remainingClarifications: 3 }, meta());
    await observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta({ requestId: 'req2' }));
    const [interpret, translate] = rows(db!);
    expect(interpret!.promptTokens).toBe(1_000_000);
    expect(interpret!.costUsd).toBeCloseTo(1 * 1 + 0.5 * 2, 10);
    expect(interpret!.costBasis).toBe('reported_usage');
    expect(interpret!.priceRevision).toBe('r1');
    expect(translate!.costUsd).toBeNull();
    expect(translate!.costBasis).toBe('unknown');
  });

  it('M05: Ollama-style sub-step timings are stored in ms with the cold-start load kept separate', async () => {
    const { observed, db } = setup({ INTERPRET: (m) => (m.report?.({ engineInferenceMs: 2400, modelLoadMs: 8200, promptTokens: 10, outputTokens: 5 }), { kind: 'PROPOSE_MEANING', meaningZh: 'x' }) }, 'local');
    await observed.dialogue.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['a'] }], remainingClarifications: 3 }, meta());
    const r = rows(db!)[0]!;
    expect(r.engineInferenceMs).toBe(2400);
    expect(r.modelLoadMs).toBe(8200);
    expect(r.costUsd).toBe(0);
    expect(r.costBasis).toBe('not_applicable');
    expect(r.durationMs).toBeLessThan(1000); // wall clock (fake timer) is its own measurement
  });

  it('M08: a thrown error is recorded as failed (with a sanitized code) and re-thrown unchanged', async () => {
    const failure = new AppError('SERVER', 'upstream said: SECRET-TRANSCRIPT-TEXT', 'LOCAL_LLM_ERROR');
    const { observed, db } = setup({ TRANSLATE: () => Promise.reject(failure) }, 'local');
    await expect(observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta())).rejects.toBe(failure);
    const r = rows(db!)[0]!;
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('LOCAL_LLM_ERROR');
    expect(JSON.stringify(db!.all('SELECT * FROM ai_requests'))).not.toContain('SECRET-TRANSCRIPT-TEXT');
  });

  it('M08: cancelled (abort signal) and timeout are distinct statuses and still counted', async () => {
    const controller = new AbortController();
    const { observed, db } = setup({
      ASR: () => {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      },
      TTS: () => Promise.reject(new AppError('TIMEOUT', 'slow', 'LOCAL_TTS_TIMEOUT')),
    });
    await expect(observed.asr.transcribe(audio, 'zh', meta({ signal: controller.signal }))).rejects.toThrow('aborted');
    await expect(observed.tts.synthesize('a', 'zh', meta({ requestId: 'req2' }))).rejects.toBeInstanceOf(AppError);
    const r = rows(db!);
    expect(r.map((x) => x.status)).toEqual(['cancelled', 'timeout']);
    expect(q.summary(db!, {}).errorCount).toBe(2);
    expect(r.every((x) => x.costUsd === null)).toBe(true); // failed calls are never priced as $0
  });

  it('the same requestId called twice (per-segment ASR) yields two distinct rows, no duplicates', async () => {
    const { observed, db } = setup({});
    await observed.asr.transcribe(audio, 'zh', meta());
    await observed.asr.transcribe(audio, 'zh', meta());
    const r = rows(db!);
    expect(r.map((x) => x.rid)).toEqual(['req1:ASR:1', 'req1:ASR:2']);
    expect(r.map((x) => x.callIndex)).toEqual([1, 2]);
  });

  it('a later call after a failed one for the same task+stage is linked as its retry', async () => {
    let n = 0;
    const { observed, db } = setup({ TRANSLATE: () => (++n === 1 ? Promise.reject(new AppError('NETWORK', 'x')) : 'ok') });
    await expect(observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta())).rejects.toThrow();
    await observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta({ requestId: 'req2' }));
    const [failed, retried] = rows(db!);
    expect(failed!.retryOfRid).toBeNull();
    expect(retried!.retryOfRid).toBe(failed!.rid);
  });

  it('a telemetry (DB) failure never changes the result or the error of the real call', async () => {
    const broken = new TelemetryDb(':memory:');
    vi.spyOn(broken, 'recordRequest').mockImplementation(() => {
      throw new Error('disk full');
    });
    const ok = setup({}, 'cloud', broken);
    await expect(ok.observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta())).resolves.toBe('y');

    const original = new AppError('SERVER', 'real failure', 'X');
    const bad = setup({ TRANSLATE: () => Promise.reject(original) }, 'cloud', broken);
    await expect(bad.observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta())).rejects.toBe(original);
  });

  it('works with telemetry disabled (db = null) and falls back to a synthetic session id', async () => {
    const none = setup({}, 'mock', null);
    await expect(none.observed.asr.transcribe(audio, 'sv', meta())).resolves.toBe('text');
    const { observed, db } = setup({});
    await observed.asr.transcribe(audio, 'sv', { taskId: 'tNoSession', requestId: 'r9' });
    expect(rows(db!)[0]!.sessionId).toBe('unknown-tNoSession');
  });

  it('reports the recorded cost to the budget hook', async () => {
    const onRecorded = vi.fn();
    const observed = observeBundle(bundleOf({ TRANSLATE: (m) => (m.report?.({ promptTokens: 1_000_000, outputTokens: 0 }), 'ok') }), {
      db: new TelemetryDb(':memory:'),
      prices: new PriceRegistry(PRICES),
      preset: 'cloud',
      providerName: 'openai',
      modelFor: () => 'llm',
      onRecorded,
    });
    await observed.dialogue.translate({ text: 'a', direction: 'ZH_TO_SV' }, meta());
    expect(onRecorded).toHaveBeenCalledWith({ preset: 'cloud', costUsd: 1 });
  });
});

describe('inferDirection', () => {
  it('prefers explicit header, then stage hints; TTS is ambiguous without a header', () => {
    expect(inferDirection('TTS', meta({ direction: 'SV_TO_ZH' }))).toBe('SV_TO_ZH');
    expect(inferDirection('INTERPRET', meta())).toBe('ZH_TO_SV');
    expect(inferDirection('ASR', meta(), { language: 'sv' })).toBe('SV_TO_ZH');
    expect(inferDirection('TRANSLATE', meta(), { direction: 'ZH_TO_SV' })).toBe('ZH_TO_SV');
    expect(inferDirection('TTS', meta(), { language: 'zh' })).toBeNull();
  });
});
