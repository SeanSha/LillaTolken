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
    expect(report.actions.card_created).toBe(0);
    db.close();
  });

  it('counts photo actions apart from vision calls', () => {
    const db = new TelemetryDb(':memory:');
    db.recordRequest(
      row({
        taskId: 'vocab.card-1',
        stage: 'IDENTIFY',
        feature: 'vocabulary',
        cardId: 'card-1',
        costUsd: 0.002,
        costBasis: 'reported_usage',
        promptTokens: 800,
        outputTokens: 20,
      }),
    );
    db.recordVocabAction({ kind: 'duplicate_detected', cardId: 'card-1', preset: 'cloud' });
    db.recordVocabAction({ kind: 'keep_existing_photo', cardId: 'card-1', preset: 'cloud' });
    db.recordVocabAction({ kind: 'direct_replace', cardId: 'card-2', preset: 'cloud' });
    db.recordVocabAction({ kind: 'exact_image_reuse', cardId: 'card-1', preset: 'cloud' });
    db.recordVocabAction({ kind: 'prevented_duplicate_request', cardId: null, preset: 'local' });
    db.recordVocabAction({ kind: 'card_created', cardId: 'card-3', preset: 'cloud' });

    const report = vocabularyUsage(db, { preset: 'cloud' });
    expect(report.identify.requests).toBe(1);
    expect(report.identify.knownUsd).toBeCloseTo(0.002);
    expect(report.actions.duplicate_detected).toBe(1);
    expect(report.actions.keep_existing_photo).toBe(1);
    expect(report.actions.direct_replace).toBe(1);
    expect(report.actions.exact_image_reuse).toBe(1);
    expect(report.actions.prevented_duplicate_request).toBe(0);
    expect(report.actions.card_created).toBe(1);
    expect(report.actions.replace_after_duplicate).toBe(0);
    expect(report.actionNote).toMatch(/skip a vision call/i);
    db.close();
  });
});
