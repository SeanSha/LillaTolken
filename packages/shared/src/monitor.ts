// Types shared by the Node monitoring API and the /monitor dashboard (docs/SYSTEM_DESIGN.md 6).
// METADATA ONLY: none of these shapes can carry audio, transcripts, prompts or translations.
import type { Direction, ProviderPreset } from './types';

export const AI_STAGES = ['ASR', 'INTERPRET', 'TRANSLATE', 'TTS', 'IDENTIFY'] as const;
export type AiStage = (typeof AI_STAGES)[number];

export const AI_FEATURES = ['translate', 'vocabulary'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const REQUEST_STATUSES = ['succeeded', 'failed', 'cancelled', 'timeout'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const COST_BASES = ['reported_usage', 'estimated', 'unknown', 'not_applicable'] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const TASK_STATUSES = ['active', 'delivered', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One real backend model-service invocation (never one per task). */
export type AiRequestRow = {
  rid: string;
  requestId: string;
  callIndex: number;
  taskId: string;
  sessionId: string;
  segmentId: string | null;
  startedAt: string;
  endedAt: string;
  preset: ProviderPreset;
  stage: AiStage;
  direction: Direction | null;
  /** Which product made the call. Rows written before this column existed are `translate`. */
  feature: AiFeature;
  /** Vocabulary card id when this call belongs to one card. Never a word or image. */
  cardId: string | null;
  /** TTS language when the call is speech. Null for other stages. */
  language: 'zh' | 'sv' | null;
  providerName: string;
  modelTag: string;
  durationMs: number;
  engineInferenceMs: number | null;
  conversionMs: number | null;
  modelLoadMs: number | null;
  inputAudioMs: number | null;
  outputAudioMs: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  cachedPromptTokens: number | null;
  status: RequestStatus;
  errorCode: string | null;
  costUsd: number | null;
  costBasis: CostBasis;
  priceRevision: string | null;
  /** Rate inputs used for the calculation (numbers/units only). */
  costDetail: CostDetail | null;
  retryOfRid: string | null;
};

export type CostDetail = {
  method: string; // e.g. "input_tokens*rate + output_tokens*rate"
  unit: string;
  rates: Record<string, number | null>;
  quantities: Record<string, number | null>;
  note?: string;
};

export type TaskRow = {
  taskId: string;
  sessionId: string;
  scenarioId: string | null;
  preset: ProviderPreset;
  direction: Direction | null;
  startedAt: string;
  endedAt: string | null;
  status: TaskStatus;
  deliveryMode: 'audio' | 'text_only' | null;
  clarificationCount: number;
  confirmationRejectCount: number;
  errorCount: number;
  playbackMs: number | null;
  taskElapsedMs: number | null;
  // aggregates (computed from linked rows)
  segmentCount: number;
  recordedMs: number;
  asrCalls: number;
  interpretCalls: number;
  translateCalls: number;
  ttsCalls: number;
  requestCount: number;
  failedRequests: number;
  processingMs: number;
  costKnownUsd: number;
  costUnknownRequests: number;
  playbackCompleted: boolean;
};

export type SegmentRow = {
  segmentId: string;
  taskId: string;
  inputPurpose: 'INITIAL' | 'CLARIFICATION' | 'CORRECTION';
  segmentIndex: number;
  capturedDurationMs: number;
  hitTimeout: boolean;
};

export type EventRow = {
  id: number;
  ts: string;
  eventType: string;
  stage: string | null;
  stageDurationMs: number | null;
  elapsedMs: number | null;
  errorCategory: string | null;
};

export type Page<T> = { rows: T[]; total: number; limit: number; offset: number };

export type MonitorFilters = {
  from?: string;
  to?: string;
  preset?: ProviderPreset;
  direction?: Direction;
  stage?: AiStage;
  model?: string;
  status?: string;
  scenarioId?: string;
  feature?: AiFeature;
};

export type LatencyStats = { count: number; avgMs: number | null; medianMs: number | null; p95Ms: number | null };

export type StageSummary = LatencyStats & {
  stage: AiStage;
  errors: number;
  avgEngineMs: number | null;
  avgModelLoadMs: number | null;
  coldStarts: number;
};

export type PresetSummary = {
  preset: ProviderPreset;
  requests: number;
  tasks: number;
  delivered: number;
  errors: number;
  avgMs: number | null;
  costKnownUsd: number;
  costUnknownRequests: number;
};

export type ModelSummary = {
  preset: ProviderPreset;
  stage: AiStage;
  modelTag: string;
  requests: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
  audioMinutes: number;
  costKnownUsd: number;
  costEstimatedUsd: number;
  /** Requests that cannot be priced (Cloud only). Shown beside the subtotal, never counted as $0. */
  costUnknownRequests: number;
};

export type SummaryResponse = {
  generatedAt: string;
  taskAttempts: number;
  deliveredTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  activeTasks: number;
  requestCount: number;
  requestsByStatus: Record<RequestStatus, number>;
  recordedAudioMinutes: number;
  segmentCount: number;
  errorCount: number;
  errorRate: number | null;
  taskElapsed: LatencyStats; // delivered tasks only
  requestLatency: LatencyStats;
  stages: StageSummary[];
  presets: PresetSummary[];
  models: ModelSummary[];
  cost: {
    cloudKnownUsd: number;
    cloudEstimatedUsd: number; // subset of known that is an estimate
    cloudUnknownRequests: number;
    cloudRequests: number;
    partial: boolean;
    localApiUsd: 0;
    note: string;
  };
  budget: BudgetStatus;
};

export type BudgetSettings = { enabled: boolean; limitUsd: number; scope: 'day' | 'session' };
export type BudgetStatus = BudgetSettings & { spentUsd: number; exceeded: boolean; nearLimit: boolean; scopeLabel: string };

export type TimeseriesPoint = {
  bucket: string; // ISO start of hour/day (UTC)
  requests: number;
  cloudCostUsd: number;
  cloudUnknown: number;
  avgMs: Partial<Record<AiStage, number>>;
  byPreset: Partial<Record<ProviderPreset, { requests: number; avgMs: number | null }>>;
};

export type PricingResponse = {
  revision: string;
  effectiveDate: string;
  sourceUrl: string;
  entries: Array<Record<string, unknown>>;
  editableOnlyOnServer: true;
};

export const MEANING_SCORES = [0, 1, 2] as const;
export type YesNoNA = 'yes' | 'no' | 'not_assessed';

export type AnnotationRow = {
  taskId: string;
  scenarioId: string | null;
  referenceMeaningCode: string | null;
  meaningScore: 0 | 1 | 2 | null;
  recipientUnderstood: YesNoNA;
  asrIssue: YesNoNA;
  uiDifficultyCount: number;
  note: string | null;
  updatedAt: string;
  // joined, read-only
  preset?: ProviderPreset;
  direction?: Direction | null;
};

export type AnnotationStats = {
  groups: Array<{
    preset: ProviderPreset;
    direction: Direction | null;
    n: number;
    meanMeaning: number | null;
    distribution: { 0: number; 1: number; 2: number };
    understoodYes: number;
    understoodAssessed: number;
    asrIssueYes: number;
    asrAssessed: number;
    uiDifficultyTotal: number;
  }>;
};

export type EngineStatus = { ok: boolean; code?: string; detail?: string; modelTag?: string };

export type LocalHealthResponse = {
  checkedAt: string;
  ready: boolean;
  /** e.g. LOCAL_TTS_UNAVAILABLE */
  status: string;
  asr: EngineStatus;
  llm: EngineStatus;
  /** Photo vocabulary. Missing here does not clear `ready` for translation. */
  vision: EngineStatus;
  tts: EngineStatus;
  lastError: { code: string; at: string } | null;
};

export type UsageBucket = {
  requests: number;
  failed: number;
  avgMs: number | null;
  knownUsd: number;
  unknownRequests: number;
};

/** Breakdown of cloud spend. The two features partition the same rows; they are not an extra total. */
export type VocabularyUsageReport = {
  vocabulary: UsageBucket;
  translation: UsageBucket;
  identify: UsageBucket;
  ttsZh: UsageBucket;
  ttsSv: UsageBucket;
  days: Array<UsageBucket & { bucket: string }>;
  months: Array<UsageBucket & { bucket: string }>;
  cards: Array<UsageBucket & { cardId: string }>;
  note: string;
};

export type CloudHealth = { configured: boolean; modelTag: string };

export type MonitorHealthResponse = { local: LocalHealthResponse; cloud: CloudHealth };
