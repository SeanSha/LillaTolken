// Records one Photo Vocabulary model call. Never stores the photo, the words, or the audio.
import { type NormalizedUsage, type RequestStatus } from '@kt/shared';
import type { PriceRegistry } from '../telemetry/pricing';
import type { TelemetryDb } from '../telemetry/db';

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

export function vocabularyCardId(header: string | undefined): string | null {
  const value = header?.trim() ?? '';
  return ID_RE.test(value) ? value : null;
}

export function recordVocabularyIdentify(opts: {
  db: TelemetryDb;
  prices: PriceRegistry;
  preset: 'cloud' | 'local';
  providerName: 'openai' | 'local';
  model: string;
  cardId: string | null;
  startedAtMs: number;
  durationMs: number;
  status: RequestStatus;
  errorCode: string | null;
  usage: NormalizedUsage;
}): void {
  const startedAt = new Date(opts.startedAtMs).toISOString();
  const requestId = `identify.${crypto.randomUUID()}`;
  const taskId = opts.cardId ? `vocab.${opts.cardId}` : `vocab.${requestId}`;
  const cost = opts.prices.calculate({
    preset: opts.preset,
    providerName: opts.providerName,
    model: opts.model,
    stage: 'IDENTIFY',
    usage: opts.usage,
    priceable: opts.status === 'succeeded',
  });
  opts.db.recordRequest({
    requestId,
    taskId,
    sessionId: 'vocabulary',
    segmentId: null,
    startedAt,
    endedAt: new Date(opts.startedAtMs + opts.durationMs).toISOString(),
    preset: opts.preset,
    stage: 'IDENTIFY',
    direction: null,
    providerName: opts.providerName,
    modelTag: opts.model,
    durationMs: opts.durationMs,
    engineInferenceMs: opts.usage.engineInferenceMs ?? null,
    conversionMs: null,
    modelLoadMs: opts.usage.modelLoadMs ?? null,
    inputAudioMs: null,
    outputAudioMs: null,
    promptTokens: opts.usage.promptTokens ?? null,
    outputTokens: opts.usage.outputTokens ?? null,
    cachedPromptTokens: opts.usage.cachedPromptTokens ?? null,
    status: opts.status,
    errorCode: opts.errorCode,
    costUsd: cost.costUsd,
    costBasis: cost.costBasis,
    priceRevision: cost.priceRevision,
    costDetail: cost.detail,
    feature: 'vocabulary',
    cardId: opts.cardId,
    language: null,
  });
}
