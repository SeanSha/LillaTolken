import { describe, expect, it } from 'vitest';
import { EvalEventSchema, type EvalEvent, type TaskSnapshot } from '@kt/shared';
import { TelemetryDb, type NewRequest } from '../../apps/server/src/telemetry/db';
import { comparisonCsv, responseLatencyCsv } from '../../apps/server/src/telemetry/export';
import { environmentComparison, getTaskDetail, listResponseLatencies, summary } from '../../apps/server/src/telemetry/queries';

const base = { sessionId: 'sess', version: 'test', direction: 'ZH_TO_SV' as const };
let n = 0;
const ev = (taskId: string, preset: EvalEvent['providerPreset'], eventType: EvalEvent['eventType'], extra: Partial<EvalEvent> = {}): EvalEvent => ({
  ts: new Date(Date.UTC(2026, 5, 1, 12, 0, ++n)).toISOString(),
  taskId,
  providerPreset: preset,
  eventType,
  ...base,
  ...extra,
});

function request(taskId: string, preset: NewRequest['preset'], durationMs: number): NewRequest {
  return {
    requestId: `req-${taskId}-${durationMs}`,
    taskId,
    sessionId: 'sess',
    segmentId: null,
    startedAt: '2026-06-01T12:00:00.000Z',
    endedAt: '2026-06-01T12:00:01.000Z',
    preset,
    stage: 'TTS',
    direction: 'ZH_TO_SV',
    providerName: preset,
    modelTag: preset === 'cloud' ? 'gpt-tts' : 'local-tts',
    durationMs,
    engineInferenceMs: null,
    conversionMs: null,
    modelLoadMs: null,
    inputAudioMs: null,
    outputAudioMs: 2000,
    promptTokens: null,
    outputTokens: null,
    cachedPromptTokens: null,
    status: 'succeeded',
    errorCode: null,
    costUsd: preset === 'cloud' ? 0.01 : 0,
    costBasis: preset === 'cloud' ? 'estimated' : 'not_applicable',
    priceRevision: null,
    costDetail: null,
  };
}

const home: TaskSnapshot = {
  testRunId: null,
  environment: 'HOME',
  networkType: 'WIFI',
  noiseLevel: 'QUIET',
  modelConfigId: 'mc_cloud',
};

describe('response latency aggregation', () => {
  it('keeps Cloud and Local apart, and does not treat TTS duration or a missing sample as the wait', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(request('cloud-task', 'cloud', 480));
    db.recordRequest(request('local-task', 'local', 120));
    db.ingestEvents([
      ev('cloud-task', 'cloud', 'TASK_STARTED'),
      ev('cloud-task', 'cloud', 'TTS_READY', { stage: 'tts', stageDurationMs: 480 }),
      ev('cloud-task', 'cloud', 'PLAYBACK_STARTED', { responseType: 'clarification', responseTrigger: 'audio_input', responseLatencyMs: 4_000, responseId: 'c1' }),
      ev('cloud-task', 'cloud', 'PLAYBACK_STARTED', { responseType: 'translation', responseTrigger: 'confirmation_tap', responseLatencyMs: 2_000, responseId: 'c2' }),
      ev('cloud-task', 'cloud', 'PLAYBACK_STARTED', { responseType: 'confirmation', responseId: 'c-missing' }),
      ev('cloud-task', 'cloud', 'PLAYBACK_COMPLETED', { playbackMs: 9_000 }),
      ev('cloud-task', 'cloud', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 30_000 }),
      ev('local-task', 'local', 'TASK_STARTED'),
      ev('local-task', 'local', 'TTS_READY', { stage: 'tts', stageDurationMs: 120 }),
      ev('local-task', 'local', 'PLAYBACK_STARTED', { responseType: 'translation', responseTrigger: 'audio_input', responseLatencyMs: 800, responseId: 'l1' }),
      ev('local-task', 'local', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 5_000 }),
      ev('old-task', 'cloud', 'TASK_STARTED'),
      ev('old-task', 'cloud', 'PLAYBACK_COMPLETED', { playbackMs: 1_000 }),
      ev('old-task', 'cloud', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 12_000 }),
    ]);

    const s = summary(db, {});
    expect(s.requestLatency.avgMs).toBe(300); // (480 + 120) / 2, model calls only
    expect(s.taskElapsed.medianMs).toBe(12_000);
    expect(s.responseLatency.headline).toBeNull();
    expect(s.responseLatency.cloud).toMatchObject({ count: 2, avgMs: 3_000, medianMs: 2_000 });
    expect(s.responseLatency.local).toMatchObject({ count: 1, avgMs: 800, medianMs: 800 });
    expect(s.responseLatency.unavailable).toBe(1);
    expect(s.responseLatency.omittedTasks).toBe(1);
    expect(s.responseLatency.byType.find((r) => r.responseType === 'clarification')?.cloud.count).toBe(1);
    expect(s.responseLatency.byType.find((r) => r.responseType === 'translation')?.local.avgMs).toBe(800);
    expect(s.responseLatency.buckets.find((b) => b.label === '0–1 s')?.local).toBe(1);
    expect(s.responseLatency.buckets.find((b) => b.label === '4–6 s')?.cloud).toBe(1);

    const cloudOnly = summary(db, { preset: 'cloud' });
    expect(cloudOnly.responseLatency.headline?.avgMs).toBe(3_000);
    expect(cloudOnly.responseLatency.local.count).toBe(0);
    expect(cloudOnly.requestLatency.avgMs).toBe(480);

    const detail = getTaskDetail(db, 'cloud-task')!;
    expect(detail.events.find((e) => e.eventType === 'PLAYBACK_STARTED' && e.responseType === 'clarification')?.responseLatencyMs).toBe(4_000);
    expect(detail.task.playbackMs).toBe(9_000);
    expect(detail.task.taskElapsedMs).toBe(30_000);
  });

  it('keeps old events valid and exports a blank latency instead of zero', () => {
    const legacy = ev('old', 'local', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 1500, playbackMs: 400 });
    expect(EvalEventSchema.safeParse(legacy).success).toBe(true);
    expect(EvalEventSchema.safeParse({ ...legacy, responseLatencyMs: -5, eventType: 'PLAYBACK_STARTED' }).success).toBe(false);

    const db = new TelemetryDb(':memory:');
    db.ingestEvents([
      ev('old', 'local', 'TASK_STARTED'),
      ev('old', 'local', 'TTS_READY', { stage: 'tts', stageDurationMs: 50 }),
      ev('old', 'local', 'PLAYBACK_COMPLETED', { playbackMs: 400 }),
      legacy,
      ev('paired', 'cloud', 'TASK_STARTED'),
      ev('paired', 'cloud', 'PLAYBACK_STARTED', { responseType: 'translation', responseTrigger: 'audio_input', responseLatencyMs: 2200, responseId: 'p1' }),
      ev('unpaired', 'cloud', 'TASK_STARTED'),
      ev('unpaired', 'cloud', 'PLAYBACK_STARTED', { responseType: 'confirmation', responseId: 'u1' }),
    ]);
    expect(summary(db, {}).responseLatency.cloud.count).toBe(1);
    expect(summary(db, {}).responseLatency.cloud.avgMs).toBe(2200);
    expect(summary(db, {}).taskElapsed.count).toBe(1);
    const stored = db.get<{ response_latency_ms: number | null; playback_ms: number | null }>(
      `SELECT e.response_latency_ms AS response_latency_ms, t.playback_ms AS playback_ms
       FROM events e JOIN tasks t ON t.task_id = e.task_id WHERE e.event_type = 'PLAYBACK_COMPLETED'`,
    );
    expect(stored?.response_latency_ms).toBeNull();
    expect(stored?.playback_ms).toBe(400);

    const csv = responseLatencyCsv(listResponseLatencies(db, {}));
    expect(csv).toContain('responseLatencyMs');
    expect(csv).toContain('2200');
    expect(csv).toContain('confirmation');
    expect(csv).not.toContain('我想');
    const unpaired = csv.split('\n').find((line) => line.includes('confirmation'));
    expect(unpaired?.split(',')[12]).toBe(''); // blank, not 0
  });

  it('filters a test session into the comparison export without mixing it into stage latency', () => {
    const db = new TelemetryDb(':memory:');
    const run = db.createTestRun({
      label: 'park',
      environment: 'HOME',
      networkType: 'WIFI',
      noiseLevel: 'QUIET',
      notes: null,
      at: '2026-06-01T09:00:00.000Z',
    });
    const snap: TaskSnapshot = { ...home, testRunId: run.testRunId };
    db.recordRequest({ ...request('t', 'cloud', 480), taskContext: snap });
    db.ingestEvents(
      [
        ev('t', 'cloud', 'TASK_STARTED'),
        ev('t', 'cloud', 'PLAYBACK_STARTED', { responseType: 'translation', responseTrigger: 'confirmation_tap', responseLatencyMs: 6100, responseId: 's1' }),
        ev('t', 'cloud', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 20_000 }),
      ],
      () => snap,
    );
    const report = environmentComparison(db, { testRunId: run.testRunId });
    expect(report.homeWifi.responseLatency).toMatchObject({ count: 1, avgMs: 6100, medianMs: 6100 });
    expect(report.homeWifi.responseByType.find((r) => r.responseType === 'translation')?.count).toBe(1);
    expect(report.homeWifi.stages.find((s) => s.stage === 'TTS')?.medianMs).toBe(480);
    expect(report.outdoorCellular.responseLatency.count).toBe(0);
    const csv = comparisonCsv(report);
    expect(csv).toContain('responseLatencyAvgMs');
    expect(csv).toContain('6100');
    expect(responseLatencyCsv(listResponseLatencies(db, { testRunId: run.testRunId }))).toContain(run.testRunId);
  });
});
