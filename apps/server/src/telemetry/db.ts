// SQLite telemetry store (docs/SYSTEM_DESIGN.md 6.3). METADATA ONLY.
// There is deliberately NO column that can hold audio, transcripts, prompts or translations.
// Uses Node's built-in `node:sqlite` (Node >= 22.13): no native add-on to compile.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import type { CostDetail, Direction, EvalEvent, EvalEnvironment, EvalNetwork, EvalNoise, ModelConfig, ProviderPreset, TaskSnapshot, TestRun } from '@kt/shared';
import { TEST_CODE_ALPHABET } from '@kt/shared';
import type { AiRequestRow } from '@kt/shared';
import type { ModelConfigSnapshot } from './modelConfig';
import { stableModelConfigId } from './modelConfig';

/** Bump with a new entry in MIGRATIONS. Migrations are additive and never drop user data. */
export const SCHEMA_VERSION = 4;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      last_seen  TEXT NOT NULL
    );
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      scenario_id TEXT,
      preset TEXT NOT NULL,
      direction TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      delivery_mode TEXT,
      clarification_count INTEGER NOT NULL DEFAULT 0,
      confirmation_reject_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      playback_ms REAL,
      task_elapsed_ms REAL,
      last_event_type TEXT
    );
    CREATE TABLE segments (
      segment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      input_purpose TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      captured_duration_ms REAL NOT NULL,
      hit_timeout INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE ai_requests (
      rid TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      call_index INTEGER NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      segment_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      preset TEXT NOT NULL,
      stage TEXT NOT NULL,
      direction TEXT,
      provider_name TEXT NOT NULL,
      model_tag TEXT NOT NULL,
      duration_ms REAL NOT NULL,
      engine_inference_ms REAL,
      conversion_ms REAL,
      model_load_ms REAL,
      input_audio_ms REAL,
      output_audio_ms REAL,
      prompt_tokens INTEGER,
      output_tokens INTEGER,
      cached_prompt_tokens INTEGER,
      status TEXT NOT NULL,
      error_code TEXT,
      cost_usd REAL,
      cost_basis TEXT NOT NULL,
      price_revision TEXT,
      cost_detail TEXT,
      retry_of_rid TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      task_id TEXT,
      preset TEXT NOT NULL,
      event_type TEXT NOT NULL,
      direction TEXT,
      scenario_id TEXT,
      model_tag TEXT,
      stage TEXT,
      stage_duration_ms REAL,
      elapsed_ms REAL,
      segment_duration_ms REAL,
      clarification_count INTEGER,
      error_category TEXT,
      delivery_mode TEXT,
      playback_ms REAL,
      version TEXT
    );
    CREATE TABLE annotations (
      task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
      scenario_id TEXT,
      reference_meaning_code TEXT,
      meaning_score INTEGER,
      recipient_understood TEXT NOT NULL DEFAULT 'not_assessed',
      asr_issue TEXT NOT NULL DEFAULT 'not_assessed',
      ui_difficulty_count INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE INDEX idx_tasks_started ON tasks(started_at);
    CREATE INDEX idx_tasks_session ON tasks(session_id);
    CREATE INDEX idx_tasks_preset ON tasks(preset);
    CREATE INDEX idx_req_started ON ai_requests(started_at);
    CREATE INDEX idx_req_task ON ai_requests(task_id);
    CREATE INDEX idx_req_preset ON ai_requests(preset);
    CREATE INDEX idx_req_stage ON ai_requests(stage);
    CREATE INDEX idx_req_model ON ai_requests(model_tag);
    CREATE INDEX idx_req_requestid ON ai_requests(request_id, stage);
    CREATE INDEX idx_seg_task ON segments(task_id);
    CREATE INDEX idx_events_task ON events(task_id);
    CREATE INDEX idx_events_ts ON events(ts);
  `,
  2: `
    ALTER TABLE ai_requests ADD COLUMN feature TEXT NOT NULL DEFAULT 'translate';
    ALTER TABLE ai_requests ADD COLUMN card_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN language TEXT;
    CREATE INDEX idx_req_feature ON ai_requests(feature);
    CREATE INDEX idx_req_card ON ai_requests(card_id);
  `,
  3: `
    CREATE TABLE test_runs (
      test_run_id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      environment TEXT NOT NULL,
      network_type TEXT NOT NULL,
      noise_level TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_seen_at TEXT
    );
    CREATE TABLE model_configs (
      model_config_id TEXT PRIMARY KEY,
      preset TEXT NOT NULL,
      asr_provider TEXT NOT NULL,
      asr_model TEXT NOT NULL,
      interpret_provider TEXT NOT NULL,
      interpret_model TEXT NOT NULL,
      translate_provider TEXT NOT NULL,
      translate_model TEXT NOT NULL,
      tts_provider TEXT NOT NULL,
      tts_model TEXT NOT NULL,
      tts_voice TEXT,
      params_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE http_rtt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_run_id TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      rtt_ms REAL NOT NULL,
      nonce TEXT NOT NULL,
      environment TEXT NOT NULL,
      network_type TEXT NOT NULL,
      noise_level TEXT NOT NULL,
      UNIQUE(test_run_id, nonce)
    );
    ALTER TABLE tasks ADD COLUMN test_run_id TEXT;
    ALTER TABLE tasks ADD COLUMN environment TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE tasks ADD COLUMN network_type TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE tasks ADD COLUMN noise_level TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE tasks ADD COLUMN model_config_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN test_run_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN environment TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE ai_requests ADD COLUMN network_type TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE ai_requests ADD COLUMN noise_level TEXT NOT NULL DEFAULT 'UNKNOWN';
    ALTER TABLE ai_requests ADD COLUMN model_config_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN voice TEXT;
    ALTER TABLE annotations ADD COLUMN test_run_id TEXT;
    ALTER TABLE annotations ADD COLUMN environment TEXT;
    ALTER TABLE annotations ADD COLUMN network_type TEXT;
    ALTER TABLE annotations ADD COLUMN noise_level TEXT;
    ALTER TABLE annotations ADD COLUMN model_config_id TEXT;
    CREATE INDEX idx_tasks_test_run ON tasks(test_run_id);
    CREATE INDEX idx_tasks_env ON tasks(environment, network_type, noise_level);
    CREATE INDEX idx_tasks_model_cfg ON tasks(model_config_id);
    CREATE INDEX idx_req_test_run ON ai_requests(test_run_id);
    CREATE INDEX idx_rtt_run ON http_rtt(test_run_id, measured_at);
    CREATE INDEX idx_runs_status ON test_runs(status, started_at);
  `,
  4: `
    ALTER TABLE events ADD COLUMN response_type TEXT;
    ALTER TABLE events ADD COLUMN response_trigger TEXT;
    ALTER TABLE events ADD COLUMN response_latency_ms REAL;
    ALTER TABLE events ADD COLUMN response_id TEXT;
  `,
};

export type NewRequest = Omit<
  AiRequestRow,
  | 'rid'
  | 'callIndex'
  | 'retryOfRid'
  | 'costDetail'
  | 'feature'
  | 'cardId'
  | 'language'
  | 'voice'
  | 'testRunId'
  | 'environment'
  | 'networkType'
  | 'noiseLevel'
  | 'modelConfigId'
> & {
  costDetail: CostDetail | null;
  feature?: AiRequestRow['feature'];
  cardId?: string | null;
  language?: 'zh' | 'sv' | null;
  voice?: string | null;
  /** Applied only when this call creates the task. An existing task keeps its snapshot. */
  taskContext?: TaskSnapshot | null;
};

const EMPTY_SNAPSHOT: TaskSnapshot = {
  testRunId: null,
  environment: 'UNKNOWN',
  networkType: 'UNKNOWN',
  noiseLevel: 'UNKNOWN',
  modelConfigId: null,
};

const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export class TelemetryDb {
  readonly raw: DatabaseSync;
  /** taskId -> a SEGMENT_TIMEOUT arrived for the segment that is about to be stopped. */
  private readonly timeoutPending = new Map<string, boolean>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  get schemaVersion(): number {
    return (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  }

  private migrate(): void {
    let current = this.schemaVersion;
    if (current > SCHEMA_VERSION) {
      throw new Error(`telemetry database is newer (v${current}) than this app (v${SCHEMA_VERSION})`);
    }
    while (current < SCHEMA_VERSION) {
      const next = current + 1;
      const sql = MIGRATIONS[next];
      if (!sql) throw new Error(`missing migration ${next}`);
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${next}`);
        this.raw.exec('COMMIT');
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
      current = next;
    }
  }

  close(): void {
    this.raw.close();
  }

  run(sql: string, ...params: SQLInputValue[]): void {
    this.raw.prepare(sql).run(...params);
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------------------------------------------------------------- sessions / tasks

  ensureSession(sessionId: string, at: string): void {
    this.run(
      `INSERT INTO sessions(session_id, first_seen, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`,
      sessionId,
      at,
      at,
    );
  }

  /**
   * Creates the task row if a request/event arrives first. Existing rows are only enriched
   * (direction / scenario). The evaluation snapshot is written on INSERT and never updated.
   */
  ensureTask(t: {
    taskId: string;
    sessionId: string;
    preset: ProviderPreset;
    direction?: Direction | null;
    scenarioId?: string | null;
    startedAt: string;
    taskContext?: TaskSnapshot | null;
  }): void {
    this.ensureSession(t.sessionId, t.startedAt);
    const snap = t.taskContext ?? EMPTY_SNAPSHOT;
    this.run(
      `INSERT INTO tasks(task_id, session_id, scenario_id, preset, direction, started_at, test_run_id, environment, network_type, noise_level, model_config_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         direction = COALESCE(tasks.direction, excluded.direction),
         scenario_id = COALESCE(tasks.scenario_id, excluded.scenario_id)`,
      t.taskId,
      t.sessionId,
      nul(t.scenarioId),
      t.preset,
      nul(t.direction),
      t.startedAt,
      snap.testRunId,
      snap.environment,
      snap.networkType,
      snap.noiseLevel,
      snap.modelConfigId,
    );
  }

  taskSnapshot(taskId: string): TaskSnapshot {
    const row = this.get<{
      test_run_id: string | null;
      environment: string | null;
      network_type: string | null;
      noise_level: string | null;
      model_config_id: string | null;
    }>('SELECT test_run_id, environment, network_type, noise_level, model_config_id FROM tasks WHERE task_id = ?', taskId);
    if (!row) return { ...EMPTY_SNAPSHOT };
    return {
      testRunId: row.test_run_id,
      environment: asEnvironment(row.environment),
      networkType: asNetwork(row.network_type),
      noiseLevel: asNoise(row.noise_level),
      modelConfigId: row.model_config_id,
    };
  }

  // ---------------------------------------------------------------- AI requests

  /** Persists exactly ONE row per backend model invocation (including failures). */
  recordRequest(r: NewRequest): string {
    return this.transaction(() => {
      this.ensureTask({
        taskId: r.taskId,
        sessionId: r.sessionId,
        preset: r.preset,
        direction: r.direction,
        startedAt: r.startedAt,
        taskContext: r.taskContext,
      });
      const snap = this.taskSnapshot(r.taskId);
      const prior = this.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM ai_requests WHERE request_id = ? AND stage = ? AND task_id = ?',
        r.requestId,
        r.stage,
        r.taskId,
      );
      const callIndex = (prior?.n ?? 0) + 1;
      const rid = `${r.requestId}:${r.stage}:${callIndex}`;
      // A retry = a later call for the same task+stage that follows a call which did not succeed.
      const failed = this.get<{ rid: string }>(
        `SELECT rid FROM ai_requests
         WHERE task_id = ? AND stage = ? AND status != 'succeeded' AND request_id != ?
         ORDER BY started_at DESC LIMIT 1`,
        r.taskId,
        r.stage,
        r.requestId,
      );
      this.run(
        `INSERT INTO ai_requests(
           rid, request_id, call_index, task_id, session_id, segment_id, started_at, ended_at, preset, stage,
           direction, provider_name, model_tag, duration_ms, engine_inference_ms, conversion_ms, model_load_ms,
           input_audio_ms, output_audio_ms, prompt_tokens, output_tokens, cached_prompt_tokens, status, error_code,
           cost_usd, cost_basis, price_revision, cost_detail, retry_of_rid, feature, card_id, language,
           test_run_id, environment, network_type, noise_level, model_config_id, voice)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        rid,
        r.requestId,
        callIndex,
        r.taskId,
        r.sessionId,
        nul(r.segmentId),
        r.startedAt,
        r.endedAt,
        r.preset,
        r.stage,
        nul(r.direction),
        r.providerName,
        r.modelTag,
        r.durationMs,
        nul(r.engineInferenceMs),
        nul(r.conversionMs),
        nul(r.modelLoadMs),
        nul(r.inputAudioMs),
        nul(r.outputAudioMs),
        nul(r.promptTokens),
        nul(r.outputTokens),
        nul(r.cachedPromptTokens),
        r.status,
        nul(r.errorCode),
        nul(r.costUsd),
        r.costBasis,
        nul(r.priceRevision),
        r.costDetail ? JSON.stringify(r.costDetail) : null,
        failed?.rid ?? null,
        r.feature ?? 'translate',
        nul(r.cardId),
        nul(r.language),
        snap.testRunId,
        snap.environment,
        snap.networkType,
        snap.noiseLevel,
        snap.modelConfigId,
        nul(r.voice),
      );
      if (snap.testRunId) this.touchTestRun(snap.testRunId, r.endedAt);
      return rid;
    });
  }

  // ---------------------------------------------------------------- client events

  /**
   * Folds the metadata-only client events into task/segment rows and keeps the raw event rows.
   * `resolveContext` is called when a task row may be created. Its result is stored only on INSERT.
   */
  ingestEvents(events: readonly EvalEvent[], resolveContext?: (event: EvalEvent) => TaskSnapshot | null): void {
    this.transaction(() => {
      for (const e of events) this.ingestOne(e, resolveContext);
    });
  }

  private ingestOne(e: EvalEvent, resolveContext?: (event: EvalEvent) => TaskSnapshot | null): void {
    this.ensureSession(e.sessionId, e.ts);
    this.run(
      `INSERT INTO events(ts, session_id, task_id, preset, event_type, direction, scenario_id, model_tag, stage,
         stage_duration_ms, elapsed_ms, segment_duration_ms, clarification_count, error_category, delivery_mode,
         playback_ms, version, response_type, response_trigger, response_latency_ms, response_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      e.ts,
      e.sessionId,
      nul(e.taskId),
      e.providerPreset,
      e.eventType,
      nul(e.direction),
      nul(e.scenarioId),
      nul(e.modelTag),
      nul(e.stage),
      nul(e.stageDurationMs),
      nul(e.elapsedMs),
      nul(e.segmentDurationMs),
      nul(e.clarificationCount),
      nul(e.errorCategory),
      nul(e.deliveryMode),
      nul(e.playbackMs),
      e.version,
      nul(e.responseType),
      nul(e.responseTrigger),
      nul(e.responseLatencyMs),
      nul(e.responseId),
    );

    if (e.eventType === 'SESSION_ENDED') {
      // A session that ends while a task is unfinished leaves that task cancelled (never "delivered").
      this.run(
        `UPDATE tasks SET status = 'cancelled', ended_at = COALESCE(ended_at, ?) WHERE session_id = ? AND status = 'active'`,
        e.ts,
        e.sessionId,
      );
      return;
    }
    const taskId = e.taskId;
    if (!taskId) return;

    this.ensureTask({
      taskId,
      sessionId: e.sessionId,
      preset: e.providerPreset,
      direction: e.direction,
      scenarioId: e.scenarioId,
      startedAt: e.ts,
      taskContext: resolveContext?.(e) ?? null,
    });

    if (e.eventType === 'TASK_STARTED') {
      const bound = this.taskSnapshot(taskId);
      if (bound.testRunId) this.touchTestRun(bound.testRunId, e.ts);
      // The event is authoritative for the start time (a request may have created the row earlier).
      this.run('UPDATE tasks SET started_at = MIN(started_at, ?) WHERE task_id = ?', e.ts, taskId);
    }
    if (e.clarificationCount !== undefined) {
      this.run('UPDATE tasks SET clarification_count = MAX(clarification_count, ?) WHERE task_id = ?', e.clarificationCount, taskId);
    }
    if (e.eventType === 'CONFIRMATION_NO') {
      this.run('UPDATE tasks SET confirmation_reject_count = confirmation_reject_count + 1 WHERE task_id = ?', taskId);
    }
    if (e.eventType === 'ERROR') {
      this.run('UPDATE tasks SET error_count = error_count + 1 WHERE task_id = ?', taskId);
    }
    if (e.eventType === 'SEGMENT_TIMEOUT') this.timeoutPending.set(taskId, true);
    if (e.eventType === 'RECORDING_STARTED') this.timeoutPending.set(taskId, false);
    if (e.eventType === 'RECORDING_STOPPED' && e.segmentDurationMs !== undefined) {
      const index =
        e.segmentIndex ??
        (this.get<{ n: number }>('SELECT COUNT(*) AS n FROM segments WHERE task_id = ?', taskId)?.n ?? 0);
      const segmentId = e.segmentId ?? `${taskId}-seg${index}`;
      this.run(
        `INSERT OR IGNORE INTO segments(segment_id, task_id, input_purpose, segment_index, captured_duration_ms, hit_timeout, recorded_at)
         VALUES (?,?,?,?,?,?,?)`,
        segmentId,
        taskId,
        e.inputPurpose ?? 'INITIAL',
        index,
        e.segmentDurationMs,
        this.timeoutPending.get(taskId) ? 1 : 0,
        e.ts,
      );
      this.timeoutPending.set(taskId, false);
    }
    if (e.eventType === 'PLAYBACK_COMPLETED' && e.playbackMs !== undefined) {
      this.run('UPDATE tasks SET playback_ms = ? WHERE task_id = ?', e.playbackMs, taskId);
    }
    if (e.eventType === 'TASK_COMPLETED') {
      this.run(
        `UPDATE tasks SET status = 'delivered', ended_at = ?, delivery_mode = ?, task_elapsed_ms = ? WHERE task_id = ?`,
        e.ts,
        nul(e.deliveryMode),
        nul(e.elapsedMs),
        taskId,
      );
    } else if (e.eventType === 'TASK_CANCELLED') {
      // Cancelled right after an error = the task failed; otherwise the adult cancelled it.
      const last = this.get<{ last_event_type: string | null }>('SELECT last_event_type FROM tasks WHERE task_id = ?', taskId);
      const status = last?.last_event_type === 'ERROR' ? 'failed' : 'cancelled';
      this.run(
        `UPDATE tasks SET status = ?, ended_at = ?, task_elapsed_ms = ? WHERE task_id = ? AND status = 'active'`,
        status,
        e.ts,
        nul(e.elapsedMs),
        taskId,
      );
    }
    this.run('UPDATE tasks SET last_event_type = ? WHERE task_id = ?', e.eventType, taskId);
  }

  // ---------------------------------------------------------------- test sessions / model configs / RTT

  createTestRun(input: {
    label: string;
    environment: TestRun['environment'];
    networkType: TestRun['networkType'];
    noiseLevel: TestRun['noiseLevel'];
    notes: string | null;
    at: string;
  }): TestRun {
    for (let attempt = 0; attempt < 5; attempt++) {
      const testRunId = `tr_${randomBytes(8).toString('hex')}`;
      const code = newTestCode();
      try {
        this.run(
          `INSERT INTO test_runs(test_run_id, code, label, environment, network_type, noise_level, notes, status, started_at)
           VALUES (?,?,?,?,?,?,?,'active',?)`,
          testRunId,
          code,
          input.label,
          input.environment,
          input.networkType,
          input.noiseLevel,
          input.notes,
          input.at,
        );
        return this.getTestRun(testRunId)!;
      } catch (error) {
        if (!isUnique(error) || attempt === 4) throw error;
      }
    }
    throw new Error('could not allocate a test session code');
  }

  listTestRuns(): TestRun[] {
    return this.all<RunRow>('SELECT * FROM test_runs ORDER BY started_at DESC, test_run_id ASC LIMIT 200').map(mapRun);
  }

  getTestRun(testRunId: string): TestRun | null {
    const row = this.get<RunRow>('SELECT * FROM test_runs WHERE test_run_id = ?', testRunId);
    return row ? mapRun(row) : null;
  }

  findActiveTestRunByCode(code: string): TestRun | null {
    const row = this.get<RunRow>(`SELECT * FROM test_runs WHERE code = ? AND status = 'active'`, code);
    return row ? mapRun(row) : null;
  }

  /** Updates conditions on an active session. Ended sessions and existing tasks are left untouched. */
  updateTestRun(
    testRunId: string,
    patch: Partial<Pick<TestRun, 'label' | 'environment' | 'networkType' | 'noiseLevel' | 'notes'>>,
  ): TestRun | null {
    const current = this.getTestRun(testRunId);
    if (!current || current.status !== 'active') return null;
    this.run(
      `UPDATE test_runs SET label = ?, environment = ?, network_type = ?, noise_level = ?, notes = ? WHERE test_run_id = ? AND status = 'active'`,
      patch.label ?? current.label,
      patch.environment ?? current.environment,
      patch.networkType ?? current.networkType,
      patch.noiseLevel ?? current.noiseLevel,
      patch.notes !== undefined ? patch.notes : current.notes,
      testRunId,
    );
    return this.getTestRun(testRunId);
  }

  endTestRun(testRunId: string, at: string): TestRun | null {
    const current = this.getTestRun(testRunId);
    if (!current) return null;
    if (current.status === 'active') {
      this.run(`UPDATE test_runs SET status = 'ended', ended_at = ? WHERE test_run_id = ? AND status = 'active'`, at, testRunId);
    }
    return this.getTestRun(testRunId);
  }

  touchTestRun(testRunId: string, at: string): void {
    this.run('UPDATE test_runs SET last_seen_at = ? WHERE test_run_id = ?', at, testRunId);
  }

  upsertModelConfig(snapshot: ModelConfigSnapshot, at: string): string {
    const id = stableModelConfigId(snapshot);
    this.run(
      `INSERT OR IGNORE INTO model_configs(
         model_config_id, preset, asr_provider, asr_model, interpret_provider, interpret_model,
         translate_provider, translate_model, tts_provider, tts_model, tts_voice, params_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      snapshot.preset,
      snapshot.asrProvider,
      snapshot.asrModel,
      snapshot.interpretProvider,
      snapshot.interpretModel,
      snapshot.translateProvider,
      snapshot.translateModel,
      snapshot.ttsProvider,
      snapshot.ttsModel,
      snapshot.ttsVoice,
      JSON.stringify(snapshot.params),
      at,
    );
    return id;
  }

  getModelConfig(id: string): ModelConfig | null {
    const row = this.get<ConfigRow>('SELECT * FROM model_configs WHERE model_config_id = ?', id);
    return row ? mapConfig(row) : null;
  }

  listModelConfigs(): ModelConfig[] {
    return this.all<ConfigRow>('SELECT * FROM model_configs ORDER BY created_at DESC LIMIT 200').map(mapConfig);
  }

  /** Client-observed HTTP round trip. The value is the phone's measurement, not server processing time. */
  recordRtt(sample: { testRunId: string; at: string; rttMs: number; nonce: string; environment: EvalEnvironment; networkType: EvalNetwork; noiseLevel: EvalNoise }): void {
    this.run(
      `INSERT INTO http_rtt(test_run_id, measured_at, rtt_ms, nonce, environment, network_type, noise_level) VALUES (?,?,?,?,?,?,?)`,
      sample.testRunId,
      sample.at,
      sample.rttMs,
      sample.nonce,
      sample.environment,
      sample.networkType,
      sample.noiseLevel,
    );
  }

  // ---------------------------------------------------------------- settings / housekeeping

  getSetting(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
  }

  setSetting(key: string, value: string): void {
    this.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  /** "Clear Adult Test Data": removes every pilot row (settings such as the budget are kept). */
  clearAll(): void {
    this.transaction(() => {
      for (const table of ['http_rtt', 'annotations', 'segments', 'ai_requests', 'events', 'tasks', 'sessions', 'test_runs', 'model_configs']) {
        this.run(`DELETE FROM ${table}`);
      }
    });
    this.timeoutPending.clear();
    this.raw.exec('VACUUM');
  }
}

function newTestCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += TEST_CODE_ALPHABET[randomInt(TEST_CODE_ALPHABET.length)]!;
  return code;
}

function isUnique(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}

export function asEnvironment(value: unknown): EvalEnvironment {
  return value === 'HOME' || value === 'OUTDOOR' ? value : 'UNKNOWN';
}

export function asNetwork(value: unknown): EvalNetwork {
  return value === 'WIFI' || value === 'CELLULAR' ? value : 'UNKNOWN';
}

export function asNoise(value: unknown): EvalNoise {
  return value === 'QUIET' || value === 'MODERATE' || value === 'NOISY' ? value : 'UNKNOWN';
}

type RunRow = {
  test_run_id: string;
  code: string;
  label: string;
  environment: string;
  network_type: string;
  noise_level: string;
  notes: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string | null;
};

function mapRun(row: RunRow): TestRun {
  return {
    testRunId: row.test_run_id,
    code: row.code,
    label: row.label,
    environment: row.environment === 'OUTDOOR' ? 'OUTDOOR' : 'HOME',
    networkType: row.network_type === 'CELLULAR' || row.network_type === 'UNKNOWN' ? row.network_type : 'WIFI',
    noiseLevel: row.noise_level === 'QUIET' || row.noise_level === 'MODERATE' || row.noise_level === 'NOISY' || row.noise_level === 'UNKNOWN' ? row.noise_level : 'UNKNOWN',
    notes: row.notes,
    status: row.status === 'ended' ? 'ended' : 'active',
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastSeenAt: row.last_seen_at,
  };
}

type ConfigRow = {
  model_config_id: string;
  preset: string;
  asr_provider: string;
  asr_model: string;
  interpret_provider: string;
  interpret_model: string;
  translate_provider: string;
  translate_model: string;
  tts_provider: string;
  tts_model: string;
  tts_voice: string | null;
  params_json: string;
  created_at: string;
};

function mapConfig(row: ConfigRow): ModelConfig {
  let params: ModelConfig['params'] = {};
  try {
    const parsed = JSON.parse(row.params_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      params = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) params[key] = value;
      }
    }
  } catch {
    params = {};
  }
  const preset: ProviderPreset = row.preset === 'cloud' || row.preset === 'local' || row.preset === 'mock' ? row.preset : 'mock';
  return {
    modelConfigId: row.model_config_id,
    preset,
    asrProvider: row.asr_provider,
    asrModel: row.asr_model,
    interpretProvider: row.interpret_provider,
    interpretModel: row.interpret_model,
    translateProvider: row.translate_provider,
    translateModel: row.translate_model,
    ttsProvider: row.tts_provider,
    ttsModel: row.tts_model,
    ttsVoice: row.tts_voice,
    params,
    createdAt: row.created_at,
  };
}
