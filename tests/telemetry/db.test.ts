// SQLite schema migrations + event folding (docs/SYSTEM_DESIGN.md 6.3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvalEvent } from '@kt/shared';
import { SCHEMA_VERSION, TelemetryDb } from '../../apps/server/src/telemetry/db';
import * as q from '../../apps/server/src/telemetry/queries';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-db-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const tableNames = (db: TelemetryDb) =>
  db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((t) => t.name);

describe('schema migrations', () => {
  it('a fresh database is migrated to the current version with every table', () => {
    const db = new TelemetryDb(':memory:');
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(['ai_requests', 'annotations', 'events', 'http_rtt', 'model_configs', 'segments', 'sessions', 'settings', 'tasks', 'test_runs']);
  });

  it('has no column able to hold audio, transcripts, prompts or translations', () => {
    const db = new TelemetryDb(':memory:');
    const forbidden = /transcript|text|prompt(?!_tokens)|translation|audio_bytes|blob|body|content|message|utterance/i;
    for (const table of tableNames(db)) {
      for (const col of db.all<{ name: string; type: string }>(`PRAGMA table_info(${table})`)) {
        expect(col.type, `${table}.${col.name}`).not.toBe('BLOB');
        // `note` (annotations, <=280 chars, adult-written, UI warns) and `cost_detail` (rate numbers) are the only free text.
        if (!['note', 'notes', 'label', 'params_json', 'cost_detail'].includes(col.name)) expect(col.name, `${table}.${col.name}`).not.toMatch(forbidden);
      }
    }
  });

  it('is idempotent and keeps existing data across re-opens', () => {
    const file = path.join(tmp(), 'telemetry.db');
    const first = new TelemetryDb(file);
    first.setSetting('budget', '{"x":1}');
    first.ensureSession('s1', '2026-01-01T00:00:00Z');
    first.close();
    const second = new TelemetryDb(file);
    expect(second.schemaVersion).toBe(SCHEMA_VERSION);
    expect(second.getSetting('budget')).toBe('{"x":1}');
    expect(second.all('SELECT * FROM sessions')).toHaveLength(1);
    second.close();
  });

  it('upgrades a legacy (version 0) file without dropping unrelated tables', () => {
    const file = path.join(tmp(), 'legacy.db');
    const legacy = new DatabaseSync(file);
    legacy.exec("CREATE TABLE keep_me (a TEXT); INSERT INTO keep_me VALUES ('still here');");
    legacy.close();
    const db = new TelemetryDb(file);
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(db.all<{ a: string }>('SELECT a FROM keep_me')).toEqual([{ a: 'still here' }]);
    expect(tableNames(db)).toContain('ai_requests');
  });

  it('refuses a database written by a NEWER app version instead of corrupting it', () => {
    const file = path.join(tmp(), 'future.db');
    const future = new DatabaseSync(file);
    future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    future.close();
    expect(() => new TelemetryDb(file)).toThrow(/newer/);
  });

  it('creates the parent directory for a file database', () => {
    const file = path.join(tmp(), 'nested/dir/t.db');
    const db = new TelemetryDb(file);
    expect(fs.existsSync(file)).toBe(true);
    db.close();
  });
});

const base = { sessionId: 'sess', providerPreset: 'local' as const, version: 'test' };
let t = 0;
const ev = (taskId: string, eventType: EvalEvent['eventType'], extra: Partial<EvalEvent> = {}): EvalEvent => ({
  ts: new Date(Date.UTC(2026, 0, 1, 12, 0, ++t)).toISOString(),
  taskId,
  direction: 'ZH_TO_SV',
  eventType,
  ...base,
  ...extra,
});

const task = (db: TelemetryDb, id: string) => q.listTasks(db, {}, { limit: 100, offset: 0 }).rows.find((r) => r.taskId === id)!;

describe('client event folding', () => {
  it('folds a delivered task: segments, playback, elapsed, clarification count', () => {
    const db = new TelemetryDb(':memory:');
    db.ingestEvents([
      ev('a', 'TASK_STARTED'),
      ev('a', 'RECORDING_STARTED'),
      ev('a', 'RECORDING_STOPPED', { segmentId: 'a-s0', segmentIndex: 0, inputPurpose: 'INITIAL', segmentDurationMs: 4000 }),
      ev('a', 'CLARIFICATION_PRESENTED', { clarificationCount: 1 }),
      ev('a', 'RECORDING_STARTED'),
      ev('a', 'RECORDING_STOPPED', { segmentId: 'a-s1', segmentIndex: 1, inputPurpose: 'CLARIFICATION', segmentDurationMs: 2500 }),
      ev('a', 'CONFIRMATION_NO'),
      ev('a', 'PLAYBACK_COMPLETED', { playbackMs: 2100 }),
      ev('a', 'TASK_COMPLETED', { deliveryMode: 'audio', elapsedMs: 31_000 }),
    ]);
    const a = task(db, 'a');
    expect(a.status).toBe('delivered');
    expect(a.segmentCount).toBe(2);
    expect(a.recordedMs).toBe(6500);
    expect(a.clarificationCount).toBe(1);
    expect(a.confirmationRejectCount).toBe(1);
    expect(a.playbackMs).toBe(2100);
    expect(a.taskElapsedMs).toBe(31_000);
    expect(a.deliveryMode).toBe('audio');
    expect(q.getTaskDetail(db, 'a')!.segments.map((s) => s.inputPurpose)).toEqual(['INITIAL', 'CLARIFICATION']);
  });

  it('M08: cancelled / failed tasks are not delivered; ending the session cancels open tasks', () => {
    const db = new TelemetryDb(':memory:');
    db.ingestEvents([
      ev('c', 'TASK_STARTED'),
      ev('c', 'TASK_CANCELLED'),
      ev('f', 'TASK_STARTED'),
      ev('f', 'ERROR', { stage: 'asr', errorCategory: 'NETWORK' }),
      ev('f', 'TASK_CANCELLED'),
      ev('open', 'TASK_STARTED'),
      ev('open', 'SESSION_ENDED', { taskId: undefined }),
    ]);
    expect(task(db, 'c').status).toBe('cancelled');
    expect(task(db, 'f').status).toBe('failed');
    expect(task(db, 'f').errorCount).toBe(1);
    expect(task(db, 'open').status).toBe('cancelled');
    expect(q.summary(db, {}).deliveredTasks).toBe(0);
  });

  it('flags the segment that hit the 30 s limit', () => {
    const db = new TelemetryDb(':memory:');
    db.ingestEvents([
      ev('x', 'TASK_STARTED'),
      ev('x', 'RECORDING_STARTED'),
      ev('x', 'SEGMENT_TIMEOUT'),
      ev('x', 'RECORDING_STOPPED', { segmentId: 'x0', segmentIndex: 0, segmentDurationMs: 30_000 }),
      ev('x', 'RECORDING_STARTED'),
      ev('x', 'RECORDING_STOPPED', { segmentId: 'x1', segmentIndex: 1, segmentDurationMs: 5000 }),
    ]);
    expect(q.getTaskDetail(db, 'x')!.segments.map((s) => s.hitTimeout)).toEqual([true, false]);
  });

  it('re-delivered events do not duplicate segments', () => {
    const db = new TelemetryDb(':memory:');
    const stop = ev('d', 'RECORDING_STOPPED', { segmentId: 'd0', segmentIndex: 0, segmentDurationMs: 1000 });
    db.ingestEvents([ev('d', 'TASK_STARTED'), stop]);
    db.ingestEvents([stop]);
    expect(task(db, 'd').segmentCount).toBe(1);
  });
});

describe('housekeeping', () => {
  it('rolls back a failed transaction completely', () => {
    const db = new TelemetryDb(':memory:');
    expect(() =>
      db.transaction(() => {
        db.ensureSession('s', 'now');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT * FROM sessions')).toHaveLength(0);
  });

  it('clearAll deletes every pilot row but keeps settings (budget)', () => {
    const db = new TelemetryDb(':memory:');
    db.setSetting('budget', 'keep');
    db.ingestEvents([ev('z', 'TASK_STARTED'), ev('z', 'TASK_COMPLETED', { elapsedMs: 5 })]);
    db.clearAll();
    for (const table of ['sessions', 'tasks', 'segments', 'ai_requests', 'events', 'annotations']) {
      expect(db.all(`SELECT * FROM ${table}`), table).toHaveLength(0);
    }
    expect(db.getSetting('budget')).toBe('keep');
  });
});
