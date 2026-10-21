// Evaluation sessions: task snapshots, model configuration, filters, CSV and HTTP RTT.
import { describe, expect, it } from 'vitest';
import type { AiStage, TaskSnapshot } from '@kt/shared';
import { loadConfig } from '../../apps/server/src/config';
import { TelemetryDb, type NewRequest } from '../../apps/server/src/telemetry/db';
import { comparisonCsv, requestsCsv, tasksCsv } from '../../apps/server/src/telemetry/export';
import { snapshotForPreset, stableModelConfigId } from '../../apps/server/src/telemetry/modelConfig';
import { observeBundle } from '../../apps/server/src/telemetry/observe';
import { PriceRegistry } from '../../apps/server/src/telemetry/pricing';
import { distribution, environmentComparison, listRequests, listTasks, upsertAnnotation, listAnnotations } from '../../apps/server/src/telemetry/queries';

const SECRET = 'sk-test-secret-should-not-leak';

function request(over: Partial<NewRequest> & Pick<NewRequest, 'taskId'>): NewRequest {
  return {
    requestId: over.requestId ?? `req-${over.taskId}`,
    sessionId: 'sess',
    segmentId: null,
    startedAt: '2026-06-01T12:00:00.000Z',
    endedAt: '2026-06-01T12:00:01.000Z',
    preset: 'cloud',
    stage: 'ASR',
    direction: 'ZH_TO_SV',
    providerName: 'openai',
    modelTag: 'gpt-4o-transcribe',
    durationMs: 800,
    engineInferenceMs: null,
    conversionMs: null,
    modelLoadMs: null,
    inputAudioMs: 3000,
    outputAudioMs: null,
    promptTokens: 10,
    outputTokens: 4,
    cachedPromptTokens: null,
    status: 'succeeded',
    errorCode: null,
    costUsd: 0.02,
    costBasis: 'reported_usage',
    priceRevision: 'r',
    costDetail: null,
    ...over,
  };
}

const snap = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  testRunId: 'tr_aaaaaaaaaaaaaaaa',
  environment: 'HOME',
  networkType: 'WIFI',
  noiseLevel: 'QUIET',
  modelConfigId: 'mc_aaaaaaaaaaaaaaaaaaaa',
  ...over,
});

describe('evaluation test sessions', () => {
  it('associates each task with the session it started in, not a later one', () => {
    const db = new TelemetryDb(':memory:');
    const home = db.createTestRun({ label: 'kitchen', environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', notes: null, at: '2026-06-01T10:00:00.000Z' });
    const park = db.createTestRun({ label: 'park', environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'NOISY', notes: 'wind', at: '2026-06-01T11:00:00.000Z' });
    db.recordRequest(request({ taskId: 'home-task', taskContext: snap({ testRunId: home.testRunId }) }));
    db.recordRequest(request({ taskId: 'park-task', requestId: 'req-park', taskContext: snap({ testRunId: park.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'NOISY' }) }));
    // A later call on the first task must keep the original snapshot even if the caller passes the other session.
    db.recordRequest(request({ taskId: 'home-task', requestId: 'req-home-2', stage: 'TTS', taskContext: snap({ testRunId: park.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'NOISY' }) }));

    const tasks = listTasks(db, {}, { limit: 10, offset: 0 }).rows;
    const homeTask = tasks.find((t) => t.taskId === 'home-task')!;
    const parkTask = tasks.find((t) => t.taskId === 'park-task')!;
    expect(homeTask.testRunId).toBe(home.testRunId);
    expect(homeTask.environment).toBe('HOME');
    expect(parkTask.testRunId).toBe(park.testRunId);
    expect(parkTask.networkType).toBe('CELLULAR');
    const calls = listRequests(db, { testRunId: home.testRunId }, { limit: 10, offset: 0 }).rows;
    expect(calls.map((r) => r.stage).sort()).toEqual(['ASR', 'TTS']);
    expect(calls.every((r) => r.testRunId === home.testRunId && r.environment === 'HOME')).toBe(true);
  });

  it('keeps a stable model configuration id and the actual request model, without secrets', () => {
    const config = loadConfig({ OPENAI_API_KEY: SECRET, OPENAI_ASR_MODEL: 'gpt-4o-transcribe', OPENAI_LLM_MODEL: 'gpt-4.1-mini', OPENAI_TTS_MODEL: 'gpt-4o-mini-tts', OPENAI_TTS_VOICE: 'alloy' } as NodeJS.ProcessEnv);
    const cloudModels = (stage: AiStage) => (stage === 'ASR' ? 'gpt-4o-transcribe' : stage === 'TTS' ? 'gpt-4o-mini-tts' : 'gpt-4.1-mini');
    const cloud = snapshotForPreset('cloud', config, cloudModels);
    const local = snapshotForPreset('local', config, (stage) => (stage === 'ASR' ? 'whisper.cpp:small' : stage === 'TTS' ? 'macos_say' : 'ollama:qwen3:8b'));
    expect(stableModelConfigId(cloud)).toBe(stableModelConfigId({ ...cloud }));
    expect(stableModelConfigId(cloud)).not.toBe(stableModelConfigId(local));
    expect(JSON.stringify(cloud) + JSON.stringify(local)).not.toContain(SECRET);
    expect(local.asrProvider).toBe('whisper.cpp');
    expect(local.interpretProvider).toBe('ollama');
    expect(local.ttsProvider).toBe('macos_say');
    expect(cloud.ttsVoice).toBe('alloy');

    const db = new TelemetryDb(':memory:');
    const id = db.upsertModelConfig(cloud, '2026-06-01T10:00:00.000Z');
    expect(db.upsertModelConfig(cloud, '2026-06-01T12:00:00.000Z')).toBe(id);
    const stored = db.getModelConfig(id)!;
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(stored.asrModel).toBe('gpt-4o-transcribe');

    const prices = new PriceRegistry();
    const observed = observeBundle(
      {
        asr: { transcribe: async (_a, _l, meta) => { meta.report?.({ resolvedModel: 'gpt-4o-transcribe-fallback' }); return 'x'; } },
        dialogue: {
          interpretChinese: async () => ({ kind: 'PROPOSE_MEANING', meaningZh: 'x' }),
          translate: async () => 'y',
        },
        tts: { synthesize: async (_t, _l, meta) => { meta.report?.({ resolvedVoice: 'alloy', resolvedModel: 'gpt-4o-mini-tts' }); return { bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }; } },
      },
      {
        db,
        prices,
        preset: 'cloud',
        providerName: 'openai',
        modelFor: cloudModels,
        resolveTaskContext: () => snap({ modelConfigId: id }),
      },
    );
    return observed.asr.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/wav', durationMs: 1000 }, 'zh', { taskId: 't-model', requestId: 'r1', sessionId: 's' }).then(async () => {
      await observed.tts.synthesize('hi', 'sv', { taskId: 't-model', requestId: 'r2', sessionId: 's' });
      const rows = listRequests(db, { testRunId: 'tr_aaaaaaaaaaaaaaaa' }, { limit: 10, offset: 0 }).rows;
      expect(rows.find((r) => r.stage === 'ASR')!.modelTag).toBe('gpt-4o-transcribe-fallback');
      expect(rows.find((r) => r.stage === 'TTS')!.voice).toBe('alloy');
      expect(listTasks(db, {}, { limit: 5, offset: 0 }).rows[0]!.modelConfigId).toBe(id);
    });
  });

  it('applies a condition change only to tasks started afterwards', () => {
    const db = new TelemetryDb(':memory:');
    const run = db.createTestRun({ label: 'walk', environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', notes: null, at: '2026-06-01T10:00:00.000Z' });
    db.recordRequest(request({ taskId: 'before', taskContext: snap({ testRunId: run.testRunId, environment: 'HOME', networkType: 'WIFI' }) }));
    const updated = db.updateTestRun(run.testRunId, { environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'MODERATE' });
    expect(updated!.environment).toBe('OUTDOOR');
    db.recordRequest(request({
      taskId: 'before',
      requestId: 'again',
      stage: 'TRANSLATE',
      taskContext: snap({ testRunId: run.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'MODERATE' }),
    }));
    db.recordRequest(request({
      taskId: 'after',
      requestId: 'new',
      taskContext: snap({ testRunId: run.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'MODERATE' }),
    }));
    expect(listTasks(db, {}, { limit: 10, offset: 0 }).rows.find((t) => t.taskId === 'before')).toMatchObject({ environment: 'HOME', networkType: 'WIFI' });
    expect(listTasks(db, {}, { limit: 10, offset: 0 }).rows.find((t) => t.taskId === 'after')).toMatchObject({ environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'MODERATE' });
    expect(db.endTestRun(run.testRunId, '2026-06-01T12:00:00.000Z')!.status).toBe('ended');
    expect(db.updateTestRun(run.testRunId, { label: 'too late' })).toBeNull();
  });

  it('shows UNKNOWN for rows that have no environment metadata and does not invent HOME or WIFI', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(request({ taskId: 'legacy' }));
    const task = listTasks(db, {}, { limit: 5, offset: 0 }).rows[0]!;
    expect(task.environment).toBe('UNKNOWN');
    expect(task.networkType).toBe('UNKNOWN');
    expect(task.noiseLevel).toBe('UNKNOWN');
    expect(task.testRunId).toBeNull();
    const home = listTasks(db, { environment: 'HOME' }, { limit: 5, offset: 0 });
    expect(home.total).toBe(0);
    const unknown = listTasks(db, { environment: 'UNKNOWN' }, { limit: 5, offset: 0 });
    expect(unknown.total).toBe(1);
  });

  it('filters and CSV exports the new columns without transcripts or secrets', () => {
    const db = new TelemetryDb(':memory:');
    const run = db.createTestRun({ label: 'kitchen', environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', notes: null, at: '2026-06-01T10:00:00.000Z' });
    db.recordRequest(request({ taskId: 'kept', taskContext: snap({ testRunId: run.testRunId }), costUsd: 0.01, costBasis: 'estimated' }));
    db.recordRequest(request({ taskId: 'other', requestId: 'o', preset: 'local', providerName: 'local', modelTag: 'ollama:qwen3:8b', costUsd: 0, costBasis: 'not_applicable', taskContext: snap({ testRunId: run.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'NOISY', modelConfigId: 'mc_bbbbbbbbbbbbbbbbbbbb' }) }));
    expect(listRequests(db, { environment: 'HOME', networkType: 'WIFI' }, { limit: 10, offset: 0 }).total).toBe(1);
    expect(listTasks(db, { modelConfigId: 'mc_bbbbbbbbbbbbbbbbbbbb' }, { limit: 10, offset: 0 }).rows.map((t) => t.taskId)).toEqual(['other']);
    const csv = requestsCsv(listRequests(db, {}, { limit: 20, offset: 0 }).rows) + tasksCsv(listTasks(db, {}, { limit: 20, offset: 0 }).rows);
    expect(csv).toContain('environment');
    expect(csv).toContain('HOME');
    expect(csv).toContain('OUTDOOR');
    expect(csv).not.toContain(SECRET);
    expect(csv).not.toContain('我想');
    expect(upsertAnnotation(db, { taskId: 'kept', meaningScore: 2, note: 'adult observation' })).toBe(true);
    const annotation = listAnnotations(db, {}, { limit: 5, offset: 0 }).rows[0]!;
    expect(annotation).toMatchObject({ testRunId: run.testRunId, environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', modelConfigId: 'mc_aaaaaaaaaaaaaaaaaaaa' });
  });

  it('keeps HTTP round-trip time out of model latency and withholds a thin P90', () => {
    const db = new TelemetryDb(':memory:');
    const run = db.createTestRun({ label: 'kitchen', environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', notes: null, at: '2026-06-01T10:00:00.000Z' });
    db.recordRequest(request({ taskId: 't', durationMs: 900, costUsd: 0.02, costBasis: 'estimated', taskContext: snap({ testRunId: run.testRunId }) }));
    for (const rttMs of [30, 40, 80]) {
      db.recordRtt({ testRunId: run.testRunId, at: '2026-06-01T12:00:00.000Z', rttMs, nonce: `n${rttMs}`, environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET' });
    }
    db.updateTestRun(run.testRunId, { environment: 'OUTDOOR', networkType: 'CELLULAR' });
    const report = environmentComparison(db, {});
    expect(report.homeWifi.httpRtt.medianMs).toBe(40);
    expect(report.homeWifi.httpRtt.p90Ms).toBeNull();
    expect(report.homeWifi.httpRtt.count).toBe(3);
    expect(report.outdoorCellular.httpRtt.count).toBe(0);
    const asr = report.homeWifi.stages.find((s) => s.stage === 'ASR')!;
    expect(asr.medianMs).toBe(900);
    expect(asr.medianMs).not.toBe(report.homeWifi.httpRtt.medianMs);
    expect(report.homeWifi.costEstimatedUsd).toBeCloseTo(0.02);
    expect(distribution([1, 2, 3, 4, 5]).p90Ms).toBe(5);
    const csv = comparisonCsv(report);
    expect(csv).toContain('httpRttMedianMs');
    expect(csv).toContain('HOME + WIFI');
    expect(csv).not.toContain(SECRET);
  });
});
