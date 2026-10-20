// Read side of the monitoring dashboard. Every query is parameterised, filterable and
// paginated server-side. Only metadata columns exist, so no query can return content.
import type {
  AiRequestRow,
  AiStage,
  AnnotationRow,
  AnnotationStats,
  BudgetSettings,
  BudgetStatus,
  CostDetail,
  Direction,
  EventRow,
  LatencyStats,
  ModelSummary,
  MonitorFilters,
  Page,
  PresetSummary,
  ProviderPreset,
  RequestStatus,
  SegmentRow,
  StageSummary,
  SummaryResponse,
  TaskRow,
  TimeseriesPoint,
  UsageBucket,
  VocabularyUsageReport,
  YesNoNA,
} from '@kt/shared';
import { AI_STAGES, PROVIDER_PRESETS, REQUEST_STATUSES } from '@kt/shared';
import type { SQLInputValue } from 'node:sqlite';
import type { TelemetryDb } from './db';

type Row = Record<string, unknown>;

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function latencyStats(values: readonly number[]): LatencyStats {
  if (values.length === 0) return { count: 0, avgMs: null, medianMs: null, p95Ms: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { count: sorted.length, avgMs: sum / sorted.length, medianMs: percentile(sorted, 50), p95Ms: percentile(sorted, 95) };
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// ------------------------------------------------------------------ filters

type Where = { sql: string; params: SQLInputValue[] };

/** `r` = ai_requests, `t` = tasks (always joined for requests). */
function requestWhere(f: MonitorFilters): Where {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  const add = (clause: string, value: SQLInputValue): void => {
    parts.push(clause);
    params.push(value);
  };
  if (f.from) add('r.started_at >= ?', f.from);
  if (f.to) add('r.started_at <= ?', f.to);
  if (f.preset) add('r.preset = ?', f.preset);
  if (f.direction) add('COALESCE(r.direction, t.direction) = ?', f.direction);
  if (f.stage) add('r.stage = ?', f.stage);
  if (f.model) add('r.model_tag = ?', f.model);
  if (f.status) add('r.status = ?', f.status);
  if (f.scenarioId) add('t.scenario_id = ?', f.scenarioId);
  if (f.feature) add('r.feature = ?', f.feature);
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function taskWhere(f: MonitorFilters): Where {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  const add = (clause: string, value: SQLInputValue): void => {
    parts.push(clause);
    params.push(value);
  };
  if (f.from) add('t.started_at >= ?', f.from);
  if (f.to) add('t.started_at <= ?', f.to);
  if (f.preset) add('t.preset = ?', f.preset);
  if (f.direction) add('t.direction = ?', f.direction);
  if (f.scenarioId) add('t.scenario_id = ?', f.scenarioId);
  if (f.status) add('t.status = ?', f.status);
  if (f.stage) add('EXISTS (SELECT 1 FROM ai_requests x WHERE x.task_id = t.task_id AND x.stage = ?)', f.stage);
  if (f.model) add('EXISTS (SELECT 1 FROM ai_requests x WHERE x.task_id = t.task_id AND x.model_tag = ?)', f.model);
  if (f.feature) add('EXISTS (SELECT 1 FROM ai_requests x WHERE x.task_id = t.task_id AND x.feature = ?)', f.feature);
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

// ------------------------------------------------------------------ mappers

export function mapRequest(r: Row): AiRequestRow {
  let costDetail: CostDetail | null = null;
  if (typeof r.cost_detail === 'string') {
    try {
      costDetail = JSON.parse(r.cost_detail) as CostDetail;
    } catch {
      costDetail = null;
    }
  }
  return {
    rid: r.rid as string,
    requestId: r.request_id as string,
    callIndex: r.call_index as number,
    taskId: r.task_id as string,
    sessionId: r.session_id as string,
    segmentId: str(r.segment_id),
    startedAt: r.started_at as string,
    endedAt: r.ended_at as string,
    preset: r.preset as ProviderPreset,
    stage: r.stage as AiStage,
    direction: (str(r.direction) ?? str(r.task_direction)) as Direction | null,
    feature: r.feature === 'vocabulary' ? 'vocabulary' : 'translate',
    cardId: str(r.card_id),
    language: r.language === 'zh' || r.language === 'sv' ? r.language : null,
    providerName: r.provider_name as string,
    modelTag: r.model_tag as string,
    durationMs: r.duration_ms as number,
    engineInferenceMs: num(r.engine_inference_ms),
    conversionMs: num(r.conversion_ms),
    modelLoadMs: num(r.model_load_ms),
    inputAudioMs: num(r.input_audio_ms),
    outputAudioMs: num(r.output_audio_ms),
    promptTokens: num(r.prompt_tokens),
    outputTokens: num(r.output_tokens),
    cachedPromptTokens: num(r.cached_prompt_tokens),
    status: r.status as RequestStatus,
    errorCode: str(r.error_code),
    costUsd: num(r.cost_usd),
    costBasis: r.cost_basis as AiRequestRow['costBasis'],
    priceRevision: str(r.price_revision),
    costDetail,
    retryOfRid: str(r.retry_of_rid),
  };
}

const TASK_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM segments s WHERE s.task_id = t.task_id) AS segment_count,
    (SELECT COALESCE(SUM(s.captured_duration_ms), 0) FROM segments s WHERE s.task_id = t.task_id) AS recorded_ms,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.stage = 'ASR') AS asr_calls,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.stage = 'INTERPRET') AS interpret_calls,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.stage = 'TRANSLATE') AS translate_calls,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.stage = 'TTS') AS tts_calls,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id) AS request_count,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.status != 'succeeded') AS failed_requests,
    (SELECT COALESCE(SUM(r.duration_ms), 0) FROM ai_requests r WHERE r.task_id = t.task_id) AS processing_ms,
    (SELECT COALESCE(SUM(r.cost_usd), 0) FROM ai_requests r WHERE r.task_id = t.task_id AND r.preset = 'cloud' AND r.cost_usd IS NOT NULL) AS cost_known,
    (SELECT COUNT(*) FROM ai_requests r WHERE r.task_id = t.task_id AND r.preset = 'cloud' AND r.cost_usd IS NULL) AS cost_unknown
  FROM tasks t`;

export function mapTask(r: Row): TaskRow {
  const startedAt = r.started_at as string;
  const endedAt = str(r.ended_at);
  const elapsed = num(r.task_elapsed_ms) ?? (endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : null);
  return {
    taskId: r.task_id as string,
    sessionId: r.session_id as string,
    scenarioId: str(r.scenario_id),
    preset: r.preset as ProviderPreset,
    direction: str(r.direction) as Direction | null,
    startedAt,
    endedAt,
    status: r.status as TaskRow['status'],
    deliveryMode: str(r.delivery_mode) as TaskRow['deliveryMode'],
    clarificationCount: r.clarification_count as number,
    confirmationRejectCount: r.confirmation_reject_count as number,
    errorCount: r.error_count as number,
    playbackMs: num(r.playback_ms),
    taskElapsedMs: elapsed,
    segmentCount: r.segment_count as number,
    recordedMs: r.recorded_ms as number,
    asrCalls: r.asr_calls as number,
    interpretCalls: r.interpret_calls as number,
    translateCalls: r.translate_calls as number,
    ttsCalls: r.tts_calls as number,
    requestCount: r.request_count as number,
    failedRequests: r.failed_requests as number,
    processingMs: r.processing_ms as number,
    costKnownUsd: r.cost_known as number,
    costUnknownRequests: r.cost_unknown as number,
    playbackCompleted: num(r.playback_ms) !== null,
  };
}

// ------------------------------------------------------------------ queries

const REQUEST_SORT: Record<string, string> = {
  startedAt: 'r.started_at',
  durationMs: 'r.duration_ms',
  stage: 'r.stage',
  costUsd: 'r.cost_usd',
  status: 'r.status',
  modelTag: 'r.model_tag',
};
const TASK_SORT: Record<string, string> = {
  startedAt: 't.started_at',
  status: 't.status',
  preset: 't.preset',
  requestCount: 'request_count',
  processingMs: 'processing_ms',
  recordedMs: 'recorded_ms',
};

export type PageOpts = { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc' };

export function listRequests(db: TelemetryDb, f: MonitorFilters, page: PageOpts): Page<AiRequestRow> {
  const w = requestWhere(f);
  const from = `FROM ai_requests r JOIN tasks t ON t.task_id = r.task_id ${w.sql}`;
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...w.params)?.n ?? 0;
  const col = REQUEST_SORT[page.sort ?? 'startedAt'] ?? 'r.started_at';
  const dir = page.order === 'asc' ? 'ASC' : 'DESC';
  const rows = db.all<Row>(
    `SELECT r.*, t.direction AS task_direction ${from} ORDER BY ${col} ${dir}, r.rid ASC LIMIT ? OFFSET ?`,
    ...w.params,
    page.limit,
    page.offset,
  );
  return { rows: rows.map(mapRequest), total, limit: page.limit, offset: page.offset };
}

export function getRequest(db: TelemetryDb, rid: string): AiRequestRow | null {
  const r = db.get<Row>('SELECT r.*, t.direction AS task_direction FROM ai_requests r JOIN tasks t ON t.task_id = r.task_id WHERE r.rid = ?', rid);
  return r ? mapRequest(r) : null;
}

export function listTasks(db: TelemetryDb, f: MonitorFilters, page: PageOpts): Page<TaskRow> {
  const w = taskWhere(f);
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks t ${w.sql}`, ...w.params)?.n ?? 0;
  const col = TASK_SORT[page.sort ?? 'startedAt'] ?? 't.started_at';
  const dir = page.order === 'asc' ? 'ASC' : 'DESC';
  const rows = db.all<Row>(`${TASK_SELECT} ${w.sql} ORDER BY ${col} ${dir}, t.task_id ASC LIMIT ? OFFSET ?`, ...w.params, page.limit, page.offset);
  return { rows: rows.map(mapTask), total, limit: page.limit, offset: page.offset };
}

export function getTaskDetail(db: TelemetryDb, taskId: string) {
  const row = db.get<Row>(`${TASK_SELECT} WHERE t.task_id = ?`, taskId);
  if (!row) return null;
  const requests = db
    .all<Row>('SELECT r.*, t.direction AS task_direction FROM ai_requests r JOIN tasks t ON t.task_id = r.task_id WHERE r.task_id = ? ORDER BY r.started_at ASC, r.rid ASC', taskId)
    .map(mapRequest);
  const segments: SegmentRow[] = db
    .all<Row>('SELECT * FROM segments WHERE task_id = ? ORDER BY segment_index ASC', taskId)
    .map((s) => ({
      segmentId: s.segment_id as string,
      taskId: s.task_id as string,
      inputPurpose: s.input_purpose as SegmentRow['inputPurpose'],
      segmentIndex: s.segment_index as number,
      capturedDurationMs: s.captured_duration_ms as number,
      hitTimeout: s.hit_timeout === 1,
    }));
  const events: EventRow[] = db
    .all<Row>('SELECT id, ts, event_type, stage, stage_duration_ms, elapsed_ms, error_category FROM events WHERE task_id = ? ORDER BY id ASC', taskId)
    .map((e) => ({
      id: e.id as number,
      ts: e.ts as string,
      eventType: e.event_type as string,
      stage: str(e.stage),
      stageDurationMs: num(e.stage_duration_ms),
      elapsedMs: num(e.elapsed_ms),
      errorCategory: str(e.error_category),
    }));
  return { task: mapTask(row), requests, segments, events };
}

// ------------------------------------------------------------------ budget

export const DEFAULT_BUDGET: BudgetSettings = { enabled: false, limitUsd: 1, scope: 'day' };

export function getBudgetSettings(db: TelemetryDb): BudgetSettings {
  const raw = db.getSetting('budget');
  if (!raw) return DEFAULT_BUDGET;
  try {
    const p = JSON.parse(raw) as Partial<BudgetSettings>;
    return {
      enabled: p.enabled === true,
      limitUsd: typeof p.limitUsd === 'number' && p.limitUsd >= 0 ? p.limitUsd : DEFAULT_BUDGET.limitUsd,
      scope: p.scope === 'session' ? 'session' : 'day',
    };
  } catch {
    return DEFAULT_BUDGET;
  }
}

export function budgetStatus(db: TelemetryDb, now: Date = new Date()): BudgetStatus {
  const s = getBudgetSettings(db);
  let spent = 0;
  let scopeLabel = 'today (UTC)';
  if (s.scope === 'day') {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    spent = db.get<{ v: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS v FROM ai_requests WHERE preset = 'cloud' AND cost_usd IS NOT NULL AND started_at >= ?", dayStart)?.v ?? 0;
  } else {
    const last = db.get<{ session_id: string }>('SELECT session_id FROM sessions ORDER BY last_seen DESC LIMIT 1');
    scopeLabel = 'latest session';
    if (last) {
      spent = db.get<{ v: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS v FROM ai_requests WHERE preset = 'cloud' AND cost_usd IS NOT NULL AND session_id = ?", last.session_id)?.v ?? 0;
    }
  }
  return { ...s, spentUsd: spent, exceeded: s.enabled && spent >= s.limitUsd, nearLimit: s.enabled && spent >= s.limitUsd * 0.8, scopeLabel };
}

// ------------------------------------------------------------------ summary

export function summary(db: TelemetryDb, f: MonitorFilters, now: Date = new Date()): SummaryResponse {
  const rw = requestWhere(f);
  const reqs = db.all<Row>(
    `SELECT r.stage, r.status, r.duration_ms, r.engine_inference_ms, r.model_load_ms, r.preset, r.cost_usd, r.cost_basis,
            r.model_tag, r.prompt_tokens, r.output_tokens, r.input_audio_ms
     FROM ai_requests r JOIN tasks t ON t.task_id = r.task_id ${rw.sql}`,
    ...rw.params,
  );
  const tw = taskWhere(f);
  const tasks = db.all<Row>(`SELECT t.task_id, t.preset, t.status, t.task_elapsed_ms, t.started_at, t.ended_at FROM tasks t ${tw.sql}`, ...tw.params);
  const segs = db.get<{ n: number; ms: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(s.captured_duration_ms), 0) AS ms FROM segments s JOIN tasks t ON t.task_id = s.task_id ${tw.sql}`,
    ...tw.params,
  ) ?? { n: 0, ms: 0 };

  const requestsByStatus = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const r of reqs) requestsByStatus[r.status as RequestStatus] += 1;
  const errorCount = reqs.length - requestsByStatus.succeeded;

  // Mock is an instant fake: averaging its ~0 ms into real latency would mislead, so latency
  // statistics cover real providers only unless the Mock preset is filtered explicitly.
  const realLatency = (r: Row) => r.preset !== 'mock' || f.preset === 'mock';
  const stages: StageSummary[] = AI_STAGES.map((stage) => {
    const rows = reqs.filter((r) => r.stage === stage && realLatency(r));
    const ok = rows.filter((r) => r.status === 'succeeded');
    const engine = ok.map((r) => num(r.engine_inference_ms)).filter((v): v is number => v !== null);
    const loads = ok.map((r) => num(r.model_load_ms)).filter((v): v is number => v !== null);
    return {
      stage,
      ...latencyStats(ok.map((r) => r.duration_ms as number)),
      errors: rows.length - ok.length,
      avgEngineMs: engine.length ? engine.reduce((a, b) => a + b, 0) / engine.length : null,
      avgModelLoadMs: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
      coldStarts: loads.filter((v) => v > 500).length,
    };
  });

  const presets: PresetSummary[] = PROVIDER_PRESETS.map((preset) => {
    const rows = reqs.filter((r) => r.preset === preset);
    const ts = tasks.filter((t) => t.preset === preset);
    const ok = rows.filter((r) => r.status === 'succeeded');
    const cloud = preset === 'cloud';
    const known = cloud ? rows.filter((r) => num(r.cost_usd) !== null) : [];
    return {
      preset,
      requests: rows.length,
      tasks: ts.length,
      delivered: ts.filter((t) => t.status === 'delivered').length,
      errors: rows.length - ok.length,
      avgMs: ok.length ? ok.reduce((a, r) => a + (r.duration_ms as number), 0) / ok.length : null,
      costKnownUsd: known.reduce((a, r) => a + (r.cost_usd as number), 0),
      costUnknownRequests: cloud ? rows.length - known.length : 0,
    };
  });

  const modelMap = new Map<string, ModelSummary>();
  for (const r of reqs) {
    const key = `${r.preset}|${r.stage}|${r.model_tag}`;
    let m = modelMap.get(key);
    if (!m) {
      m = { preset: r.preset as ProviderPreset, stage: r.stage as AiStage, modelTag: r.model_tag as string, requests: 0, failed: 0, promptTokens: 0, outputTokens: 0, audioMinutes: 0, costKnownUsd: 0, costEstimatedUsd: 0, costUnknownRequests: 0 };
      modelMap.set(key, m);
    }
    m.requests += 1;
    if (r.status !== 'succeeded') m.failed += 1;
    m.promptTokens += num(r.prompt_tokens) ?? 0;
    m.outputTokens += num(r.output_tokens) ?? 0;
    m.audioMinutes += (num(r.input_audio_ms) ?? 0) / 60_000;
    if (r.preset === 'cloud') {
      const c = num(r.cost_usd);
      if (c === null) m.costUnknownRequests += 1;
      else {
        m.costKnownUsd += c;
        if (r.cost_basis === 'estimated') m.costEstimatedUsd += c;
      }
    }
  }

  const cloudRows = reqs.filter((r) => r.preset === 'cloud');
  const knownCloud = cloudRows.filter((r) => num(r.cost_usd) !== null);
  const unknownCloud = cloudRows.length - knownCloud.length;

  return {
    generatedAt: now.toISOString(),
    taskAttempts: tasks.length,
    deliveredTasks: tasks.filter((t) => t.status === 'delivered').length,
    failedTasks: tasks.filter((t) => t.status === 'failed').length,
    cancelledTasks: tasks.filter((t) => t.status === 'cancelled').length,
    activeTasks: tasks.filter((t) => t.status === 'active').length,
    requestCount: reqs.length,
    requestsByStatus,
    recordedAudioMinutes: segs.ms / 60_000,
    segmentCount: segs.n,
    errorCount,
    errorRate: reqs.length ? errorCount / reqs.length : null,
    taskElapsed: latencyStats(
      tasks
        .filter((t) => t.status === 'delivered' && (t.preset !== 'mock' || f.preset === 'mock'))
        .map((t) => num(t.task_elapsed_ms))
        .filter((v): v is number => v !== null),
    ),
    requestLatency: latencyStats(reqs.filter((r) => r.status === 'succeeded' && realLatency(r)).map((r) => r.duration_ms as number)),
    stages,
    presets,
    models: [...modelMap.values()].sort((a, b) => b.requests - a.requests),
    cost: {
      cloudKnownUsd: knownCloud.reduce((a, r) => a + (r.cost_usd as number), 0),
      cloudEstimatedUsd: knownCloud.filter((r) => r.cost_basis === 'estimated').reduce((a, r) => a + (r.cost_usd as number), 0),
      cloudUnknownRequests: unknownCloud,
      cloudRequests: cloudRows.length,
      partial: unknownCloud > 0,
      localApiUsd: 0,
      note: 'Cloud figures are an estimate/attribution view, not authoritative provider billing. Local API: $0 (hardware/power excluded). Unknown is never summed as $0.',
    },
    budget: budgetStatus(db, now),
  };
}

// ------------------------------------------------------------------ time series

export function timeseries(db: TelemetryDb, f: MonitorFilters, bucket: 'hour' | 'day'): TimeseriesPoint[] {
  const w = requestWhere(f);
  const fmt = bucket === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%dT00:00:00Z';
  const rows = db.all<Row>(
    `SELECT strftime('${fmt}', r.started_at) AS bucket, r.stage, r.preset, r.status, r.duration_ms, r.cost_usd
     FROM ai_requests r JOIN tasks t ON t.task_id = r.task_id ${w.sql} ORDER BY r.started_at ASC`,
    ...w.params,
  );
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.bucket as string;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()].map(([bucketKey, rs]) => {
    const avgMs: TimeseriesPoint['avgMs'] = {};
    for (const stage of AI_STAGES) {
      const v = rs.filter((r) => r.stage === stage && r.status === 'succeeded' && (r.preset !== 'mock' || f.preset === 'mock')).map((r) => r.duration_ms as number);
      if (v.length) avgMs[stage] = v.reduce((a, b) => a + b, 0) / v.length;
    }
    const byPreset: TimeseriesPoint['byPreset'] = {};
    for (const preset of PROVIDER_PRESETS) {
      const p = rs.filter((r) => r.preset === preset);
      if (!p.length) continue;
      const ok = p.filter((r) => r.status === 'succeeded');
      byPreset[preset] = { requests: p.length, avgMs: ok.length ? ok.reduce((a, r) => a + (r.duration_ms as number), 0) / ok.length : null };
    }
    const cloud = rs.filter((r) => r.preset === 'cloud');
    return {
      bucket: bucketKey,
      requests: rs.length,
      cloudCostUsd: cloud.reduce((a, r) => a + (num(r.cost_usd) ?? 0), 0),
      cloudUnknown: cloud.filter((r) => num(r.cost_usd) === null).length,
      avgMs,
      byPreset,
    };
  });
}

// ------------------------------------------------------------------ annotations

export type AnnotationInput = {
  taskId: string;
  scenarioId?: string | null;
  referenceMeaningCode?: string | null;
  meaningScore?: 0 | 1 | 2 | null;
  recipientUnderstood?: YesNoNA;
  asrIssue?: YesNoNA;
  uiDifficultyCount?: number;
  note?: string | null;
};

export function upsertAnnotation(db: TelemetryDb, a: AnnotationInput, at: Date = new Date()): boolean {
  const task = db.get<{ scenario_id: string | null }>('SELECT scenario_id FROM tasks WHERE task_id = ?', a.taskId);
  if (!task) return false;
  db.run(
    `INSERT INTO annotations(task_id, scenario_id, reference_meaning_code, meaning_score, recipient_understood, asr_issue, ui_difficulty_count, note, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(task_id) DO UPDATE SET
       scenario_id = excluded.scenario_id, reference_meaning_code = excluded.reference_meaning_code,
       meaning_score = excluded.meaning_score, recipient_understood = excluded.recipient_understood,
       asr_issue = excluded.asr_issue, ui_difficulty_count = excluded.ui_difficulty_count,
       note = excluded.note, updated_at = excluded.updated_at`,
    a.taskId,
    a.scenarioId ?? task.scenario_id ?? null,
    a.referenceMeaningCode ?? null,
    a.meaningScore ?? null,
    a.recipientUnderstood ?? 'not_assessed',
    a.asrIssue ?? 'not_assessed',
    a.uiDifficultyCount ?? 0,
    a.note ?? null,
    at.toISOString(),
  );
  return true;
}

function mapAnnotation(r: Row): AnnotationRow {
  return {
    taskId: r.task_id as string,
    scenarioId: str(r.scenario_id),
    referenceMeaningCode: str(r.reference_meaning_code),
    meaningScore: num(r.meaning_score) as AnnotationRow['meaningScore'],
    recipientUnderstood: r.recipient_understood as YesNoNA,
    asrIssue: r.asr_issue as YesNoNA,
    uiDifficultyCount: r.ui_difficulty_count as number,
    note: str(r.note),
    updatedAt: r.updated_at as string,
    preset: r.preset as ProviderPreset,
    direction: str(r.direction) as Direction | null,
  };
}

export function listAnnotations(db: TelemetryDb, f: MonitorFilters, page: PageOpts): Page<AnnotationRow> {
  const w = taskWhere(f);
  const from = `FROM annotations a JOIN tasks t ON t.task_id = a.task_id ${w.sql}`;
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...w.params)?.n ?? 0;
  const rows = db.all<Row>(`SELECT a.*, t.preset, t.direction ${from} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`, ...w.params, page.limit, page.offset);
  return { rows: rows.map(mapAnnotation), total, limit: page.limit, offset: page.offset };
}

export function annotationStats(db: TelemetryDb, f: MonitorFilters): AnnotationStats {
  const w = taskWhere(f);
  const rows = db
    .all<Row>(`SELECT a.*, t.preset, t.direction FROM annotations a JOIN tasks t ON t.task_id = a.task_id ${w.sql}`, ...w.params)
    .map(mapAnnotation);
  const groups = new Map<string, AnnotationRow[]>();
  for (const r of rows) {
    const key = `${r.preset}|${r.direction ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return {
    groups: [...groups.values()].map((rs) => {
      const scored = rs.filter((r) => r.meaningScore !== null);
      const dist = { 0: 0, 1: 0, 2: 0 } as { 0: number; 1: number; 2: number };
      for (const r of scored) dist[r.meaningScore as 0 | 1 | 2] += 1;
      return {
        preset: rs[0]!.preset as ProviderPreset,
        direction: rs[0]!.direction ?? null,
        n: rs.length,
        meanMeaning: scored.length ? scored.reduce((a, r) => a + (r.meaningScore as number), 0) / scored.length : null,
        distribution: dist,
        understoodYes: rs.filter((r) => r.recipientUnderstood === 'yes').length,
        understoodAssessed: rs.filter((r) => r.recipientUnderstood !== 'not_assessed').length,
        asrIssueYes: rs.filter((r) => r.asrIssue === 'yes').length,
        asrAssessed: rs.filter((r) => r.asrIssue !== 'not_assessed').length,
        uiDifficultyTotal: rs.reduce((a, r) => a + r.uiDifficultyCount, 0),
      };
    }),
  };
}

const USAGE_NOTE =
  'Photo Vocabulary and translation are two slices of the same cloud request rows. Adding them again on top of the Cloud total would count twice. Cached audio replays are not rows. A retry is a separate API call and is counted once.';

function bucket(row: Row | undefined): UsageBucket {
  const requests = Number(row?.requests ?? 0);
  const failed = Number(row?.failed ?? 0);
  const duration = Number(row?.duration ?? 0);
  return {
    requests,
    failed,
    avgMs: requests > 0 ? duration / requests : null,
    knownUsd: Number(row?.known ?? 0),
    unknownRequests: Number(row?.unknown ?? 0),
  };
}

const USAGE_SQL = `SELECT COUNT(*) AS requests,
  SUM(CASE WHEN status != 'succeeded' THEN 1 ELSE 0 END) AS failed,
  COALESCE(SUM(duration_ms), 0) AS duration,
  COALESCE(SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS known,
  SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown
  FROM ai_requests WHERE feature = ?`;

export function vocabularyUsage(db: TelemetryDb, f: MonitorFilters): VocabularyUsageReport {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.from) {
    parts.push('started_at >= ?');
    params.push(f.from);
  }
  if (f.to) {
    parts.push('started_at <= ?');
    params.push(f.to);
  }
  if (f.preset) {
    parts.push('preset = ?');
    params.push(f.preset);
  }
  const window = parts.length ? ` AND ${parts.join(' AND ')}` : '';
  const one = (feature: string, extra = '') => bucket(db.get<Row>(`${USAGE_SQL}${window}${extra}`, feature, ...params));
  const series = (fmt: string) =>
    db
      .all<Row>(
        `SELECT strftime('${fmt}', started_at) AS bucket, COUNT(*) AS requests,
           SUM(CASE WHEN status != 'succeeded' THEN 1 ELSE 0 END) AS failed,
           COALESCE(SUM(duration_ms), 0) AS duration,
           COALESCE(SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS known,
           SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown
         FROM ai_requests WHERE feature = 'vocabulary'${window}
         GROUP BY bucket ORDER BY bucket`,
        ...params,
      )
      .map((row) => ({ bucket: String(row.bucket), ...bucket(row) }));
  const cards = db
    .all<Row>(
      `SELECT card_id, COUNT(*) AS requests,
         SUM(CASE WHEN status != 'succeeded' THEN 1 ELSE 0 END) AS failed,
         COALESCE(SUM(duration_ms), 0) AS duration,
         COALESCE(SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS known,
         SUM(CASE WHEN preset = 'cloud' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown
       FROM ai_requests WHERE feature = 'vocabulary' AND card_id IS NOT NULL${window}
       GROUP BY card_id ORDER BY known DESC, requests DESC LIMIT 50`,
      ...params,
    )
    .map((row) => ({ cardId: String(row.card_id), ...bucket(row) }));
  return {
    vocabulary: one('vocabulary'),
    translation: one('translate'),
    identify: one('vocabulary', ` AND stage = 'IDENTIFY'`),
    ttsZh: one('vocabulary', ` AND stage = 'TTS' AND language = 'zh'`),
    ttsSv: one('vocabulary', ` AND stage = 'TTS' AND language = 'sv'`),
    days: series('%Y-%m-%d'),
    months: series('%Y-%m'),
    cards,
    note: USAGE_NOTE,
  };
}
