// Optional CSV backup of monitoring metadata. Same columns as the dashboard: no content, ever.
// Categorical gaps are the literal UNKNOWN. Missing ids and numbers are blank. Never a guessed HOME or WIFI.
import type { AiRequestRow, AnnotationRow, ComparisonResponse, TaskRow, TestRun } from '@kt/shared';
import { csvCell } from '../evaluation/eventStore';

const cat = (value: string | null | undefined) => (value && value.length > 0 ? value : 'UNKNOWN');
const id = (value: string | null | undefined) => value ?? '';

function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<readonly [string, (r: T) => unknown]>): string {
  const lines = [columns.map(([name]) => name).join(',')];
  for (const r of rows) lines.push(columns.map(([, get]) => csvCell(get(r))).join(','));
  return `${lines.join('\n')}\n`;
}

export const requestsCsv = (rows: readonly AiRequestRow[]) =>
  toCsv(rows, [
    ['startedAt', (r) => r.startedAt],
    ['requestId', (r) => r.requestId],
    ['callIndex', (r) => r.callIndex],
    ['taskId', (r) => r.taskId],
    ['sessionId', (r) => r.sessionId],
    ['preset', (r) => r.preset],
    ['stage', (r) => r.stage],
    ['direction', (r) => r.direction],
    ['providerName', (r) => r.providerName],
    ['modelTag', (r) => r.modelTag],
    ['durationMs', (r) => r.durationMs],
    ['engineInferenceMs', (r) => r.engineInferenceMs],
    ['conversionMs', (r) => r.conversionMs],
    ['modelLoadMs', (r) => r.modelLoadMs],
    ['inputAudioMs', (r) => r.inputAudioMs],
    ['outputAudioMs', (r) => r.outputAudioMs],
    ['promptTokens', (r) => r.promptTokens],
    ['outputTokens', (r) => r.outputTokens],
    ['cachedPromptTokens', (r) => r.cachedPromptTokens],
    ['status', (r) => r.status],
    ['errorCode', (r) => r.errorCode],
    ['costUsd', (r) => r.costUsd],
    ['costBasis', (r) => r.costBasis],
    ['priceRevision', (r) => r.priceRevision],
    ['retryOfRid', (r) => r.retryOfRid],
    ['testRunId', (r) => id(r.testRunId)],
    ['environment', (r) => cat(r.environment)],
    ['networkType', (r) => cat(r.networkType)],
    ['noiseLevel', (r) => cat(r.noiseLevel)],
    ['modelConfigId', (r) => id(r.modelConfigId)],
    ['voice', (r) => r.voice],
  ]);

export const tasksCsv = (rows: readonly TaskRow[]) =>
  toCsv(rows, [
    ['taskId', (r) => r.taskId],
    ['sessionId', (r) => r.sessionId],
    ['scenarioId', (r) => r.scenarioId],
    ['preset', (r) => r.preset],
    ['direction', (r) => r.direction],
    ['startedAt', (r) => r.startedAt],
    ['endedAt', (r) => r.endedAt],
    ['status', (r) => r.status],
    ['deliveryMode', (r) => r.deliveryMode],
    ['segmentCount', (r) => r.segmentCount],
    ['recordedMs', (r) => r.recordedMs],
    ['asrCalls', (r) => r.asrCalls],
    ['interpretCalls', (r) => r.interpretCalls],
    ['translateCalls', (r) => r.translateCalls],
    ['ttsCalls', (r) => r.ttsCalls],
    ['clarificationCount', (r) => r.clarificationCount],
    ['confirmationRejectCount', (r) => r.confirmationRejectCount],
    ['processingMs', (r) => r.processingMs],
    ['taskElapsedMs', (r) => r.taskElapsedMs],
    ['playbackMs', (r) => r.playbackMs],
    ['costKnownUsd', (r) => r.costKnownUsd],
    ['costUnknownRequests', (r) => r.costUnknownRequests],
    ['testRunId', (r) => id(r.testRunId)],
    ['environment', (r) => cat(r.environment)],
    ['networkType', (r) => cat(r.networkType)],
    ['noiseLevel', (r) => cat(r.noiseLevel)],
    ['modelConfigId', (r) => id(r.modelConfigId)],
  ]);

export const annotationsCsv = (rows: readonly AnnotationRow[]) =>
  toCsv(rows, [
    ['taskId', (r) => r.taskId],
    ['scenarioId', (r) => r.scenarioId],
    ['preset', (r) => r.preset],
    ['direction', (r) => r.direction],
    ['referenceMeaningCode', (r) => r.referenceMeaningCode],
    ['meaningScore', (r) => r.meaningScore],
    ['recipientUnderstood', (r) => r.recipientUnderstood],
    ['asrIssue', (r) => r.asrIssue],
    ['uiDifficultyCount', (r) => r.uiDifficultyCount],
    ['note', (r) => r.note],
    ['updatedAt', (r) => r.updatedAt],
    ['testRunId', (r) => id(r.testRunId)],
    ['environment', (r) => cat(r.environment)],
    ['networkType', (r) => cat(r.networkType)],
    ['noiseLevel', (r) => cat(r.noiseLevel)],
    ['modelConfigId', (r) => id(r.modelConfigId)],
  ]);

export const testRunsCsv = (rows: readonly TestRun[]) =>
  toCsv(rows, [
    ['testRunId', (r) => r.testRunId],
    ['code', (r) => r.code],
    ['label', (r) => r.label],
    ['environment', (r) => r.environment],
    ['networkType', (r) => r.networkType],
    ['noiseLevel', (r) => r.noiseLevel],
    ['status', (r) => r.status],
    ['startedAt', (r) => r.startedAt],
    ['endedAt', (r) => r.endedAt],
    ['lastSeenAt', (r) => r.lastSeenAt],
    ['notes', (r) => r.notes],
  ]);

export const comparisonCsv = (report: ComparisonResponse) => {
  const rows = [report.homeWifi, report.outdoorCellular].flatMap((col) => {
    const splits = col.splits.length > 0 ? col.splits : [null];
    return splits.map((split, index) => ({
      condition: col.label,
      environment: col.environment,
      networkType: col.networkType,
      configsDiffer: col.configsDiffer,
      modelConfigId: split?.modelConfigId ?? '',
      asrProvider: split?.config?.asrProvider ?? 'UNKNOWN',
      asrModel: split?.config?.asrModel ?? 'UNKNOWN',
      interpretProvider: split?.config?.interpretProvider ?? 'UNKNOWN',
      interpretModel: split?.config?.interpretModel ?? 'UNKNOWN',
      translateProvider: split?.config?.translateProvider ?? 'UNKNOWN',
      translateModel: split?.config?.translateModel ?? 'UNKNOWN',
      ttsProvider: split?.config?.ttsProvider ?? 'UNKNOWN',
      ttsModel: split?.config?.ttsModel ?? 'UNKNOWN',
      ttsVoice: split?.config?.ttsVoice ?? 'UNKNOWN',
      taskCount: split?.taskCount ?? col.taskCount,
      requestCount: split?.requestCount ?? col.requestCount,
      tasksDelivered: split?.tasksDelivered ?? col.tasksDelivered,
      tasksFailed: split?.tasksFailed ?? col.tasksFailed,
      taskElapsedCount: split?.taskElapsed.count ?? col.taskElapsed.count,
      taskElapsedMedianMs: split?.taskElapsed.medianMs ?? null,
      taskElapsedP90Ms: split?.taskElapsed.p90Ms ?? null,
      httpRttCount: index === 0 ? col.httpRtt.count : null,
      httpRttMedianMs: index === 0 ? col.httpRtt.medianMs : null,
      httpRttP90Ms: index === 0 ? col.httpRtt.p90Ms : null,
      recordedAudioMs: split?.recordedAudioMs ?? col.recordedAudioMs,
      costKnownUsd: split?.costKnownUsd ?? col.costKnownUsd,
      costEstimatedUsd: split?.costEstimatedUsd ?? col.costEstimatedUsd,
      costUnknownRequests: split?.costUnknownRequests ?? col.costUnknownRequests,
      cloudRequests: split?.cloudRequests ?? col.cloudRequests,
      requestModels: split ? split.requestModels.map((m) => `${m.stage}=${m.modelTag}`).join(';') : '',
      asrMedianMs: stageMs(split?.stages ?? col.stages, 'ASR', 'medianMs'),
      asrP90Ms: stageMs(split?.stages ?? col.stages, 'ASR', 'p90Ms'),
      interpretMedianMs: stageMs(split?.stages ?? col.stages, 'INTERPRET', 'medianMs'),
      interpretP90Ms: stageMs(split?.stages ?? col.stages, 'INTERPRET', 'p90Ms'),
      translateMedianMs: stageMs(split?.stages ?? col.stages, 'TRANSLATE', 'medianMs'),
      translateP90Ms: stageMs(split?.stages ?? col.stages, 'TRANSLATE', 'p90Ms'),
      ttsMedianMs: stageMs(split?.stages ?? col.stages, 'TTS', 'medianMs'),
      ttsP90Ms: stageMs(split?.stages ?? col.stages, 'TTS', 'p90Ms'),
    }));
  });
  return toCsv(rows, [
    ['condition', (r) => r.condition],
    ['environment', (r) => r.environment],
    ['networkType', (r) => r.networkType],
    ['configsDiffer', (r) => r.configsDiffer],
    ['modelConfigId', (r) => r.modelConfigId],
    ['asrProvider', (r) => r.asrProvider],
    ['asrModel', (r) => r.asrModel],
    ['interpretProvider', (r) => r.interpretProvider],
    ['interpretModel', (r) => r.interpretModel],
    ['translateProvider', (r) => r.translateProvider],
    ['translateModel', (r) => r.translateModel],
    ['ttsProvider', (r) => r.ttsProvider],
    ['ttsModel', (r) => r.ttsModel],
    ['ttsVoice', (r) => r.ttsVoice],
    ['taskCount', (r) => r.taskCount],
    ['requestCount', (r) => r.requestCount],
    ['tasksDelivered', (r) => r.tasksDelivered],
    ['tasksFailed', (r) => r.tasksFailed],
    ['taskElapsedCount', (r) => r.taskElapsedCount],
    ['taskElapsedMedianMs', (r) => r.taskElapsedMedianMs],
    ['taskElapsedP90Ms', (r) => r.taskElapsedP90Ms],
    ['asrMedianMs', (r) => r.asrMedianMs],
    ['asrP90Ms', (r) => r.asrP90Ms],
    ['interpretMedianMs', (r) => r.interpretMedianMs],
    ['interpretP90Ms', (r) => r.interpretP90Ms],
    ['translateMedianMs', (r) => r.translateMedianMs],
    ['translateP90Ms', (r) => r.translateP90Ms],
    ['ttsMedianMs', (r) => r.ttsMedianMs],
    ['ttsP90Ms', (r) => r.ttsP90Ms],
    ['httpRttCount', (r) => r.httpRttCount],
    ['httpRttMedianMs', (r) => r.httpRttMedianMs],
    ['httpRttP90Ms', (r) => r.httpRttP90Ms],
    ['recordedAudioMs', (r) => r.recordedAudioMs],
    ['costKnownUsd', (r) => r.costKnownUsd],
    ['costEstimatedUsd', (r) => r.costEstimatedUsd],
    ['costUnknownRequests', (r) => r.costUnknownRequests],
    ['cloudRequests', (r) => r.cloudRequests],
    ['requestModels', (r) => r.requestModels],
  ]);
};

function stageMs(stages: ReadonlyArray<{ stage: string; medianMs: number | null; p90Ms: number | null }>, stage: string, field: 'medianMs' | 'p90Ms'): number | null {
  return stages.find((s) => s.stage === stage)?.[field] ?? null;
}
