// Optional CSV backup of monitoring metadata. Same columns as the dashboard: no content, ever.
import type { AiRequestRow, AnnotationRow, TaskRow } from '@kt/shared';
import { csvCell } from '../evaluation/eventStore';

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
  ]);
