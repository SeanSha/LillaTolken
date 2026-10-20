import { describe, expect, it } from 'vitest';
import { TelemetryDb, type NewRequest } from '../../apps/server/src/telemetry/db';
import { vocabularyUsage } from '../../apps/server/src/telemetry/queries';

let seq = 0;
function row(over: Partial<NewRequest> & Pick<NewRequest, 'taskId' | 'stage'>): NewRequest {
  const n = ++seq;
  return {
    requestId: `req${n}`,
    sessionId: 's1',
    segmentId: null,
    startedAt: new Date(Date.UTC(2026, 9, 20, 8, 0, n)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 9, 20, 8, 0, n)).toISOString(),
    preset: 'cloud',
    direction: null,
    providerName: 'openai',
    modelTag: 'gpt-4.1-mini',
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
    priceRevision: null,
    costDetail: null,
    ...over,
  };
}

describe('vocabulary cost accounting', () => {
  it('splits vocabulary from translation without counting a row twice', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(row({ taskId: 'translate.1', stage: 'TRANSLATE', costUsd: 0.01, costBasis: 'reported_usage', promptTokens: 10, outputTokens: 10 }));
    db.recordRequest(
      row({
        taskId: 'vocab.card-1',
        stage: 'IDENTIFY',
        feature: 'vocabulary',
        cardId: 'card-1',
        costUsd: 0.002,
        costBasis: 'reported_usage',
        promptTokens: 1000,
        outputTokens: 20,
      }),
    );
    db.recordRequest(row({ taskId: 'vocab.card-1', stage: 'TTS', feature: 'vocabulary', cardId: 'card-1', language: 'zh' }));
    db.recordRequest(row({ taskId: 'vocab.card-1', stage: 'TTS', feature: 'vocabulary', cardId: 'card-1', language: 'sv' }));
    db.recordRequest(row({ taskId: 'old', stage: 'ASR' }));

    const report = vocabularyUsage(db, {});
    expect(report.vocabulary.requests + report.translation.requests).toBe(5);
    expect(report.vocabulary.requests).toBe(3);
    expect(report.translation.requests).toBe(2);
    expect(report.identify.requests).toBe(1);
    expect(report.identify.knownUsd).toBeCloseTo(0.002);
    expect(report.ttsZh.requests).toBe(1);
    expect(report.ttsZh.unknownRequests).toBe(1);
    expect(report.ttsZh.knownUsd).toBe(0);
    expect(report.cards.map((card) => card.cardId)).toEqual(['card-1']);
    expect(report.cards[0]?.requests).toBe(3);
    expect(report.note).toMatch(/twice/i);
    db.close();
  });
});
