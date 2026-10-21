import { useEffect, useState, type FormEvent } from 'react';
import type { TaskRow, YesNoNA } from '@kt/shared';
import { MonitorApiError, monitorApi } from './api';
import { useMonitor } from './context';
import { fmtTime } from './format';
import { usePolled } from './hooks';
import { ErrorNote } from './parts';

type Form = {
  taskId: string;
  referenceMeaningCode: string;
  meaningScore: '' | '0' | '1' | '2';
  recipientUnderstood: YesNoNA;
  asrIssue: YesNoNA;
  uiDifficultyCount: number;
  note: string;
};

const EMPTY: Form = { taskId: '', referenceMeaningCode: '', meaningScore: '', recipientUnderstood: 'not_assessed', asrIssue: 'not_assessed', uiDifficultyCount: 0, note: '' };

const mean = (v: number | null) => (v === null ? '—' : v.toFixed(2));

export function EvaluationTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [key]);

  const tasks = usePolled(() => monitorApi.tasks({}, { limit: 100, offset: 0, sort: 'startedAt', order: 'desc' }), [], 10_000);
  const list = usePolled(() => monitorApi.annotations(resolve(), { limit: 25, offset }), [key, offset], intervalMs);
  const stats = usePolled(() => monitorApi.annotationStats(resolve()), [key], intervalMs);
  useEffect(() => {
    if ([tasks.error, list.error, stats.error].some((e) => e?.status === 401)) onAuthError();
  }, [tasks.error, list.error, stats.error, onAuthError]);

  const taskById = new Map((tasks.data?.rows ?? []).map((t: TaskRow) => [t.taskId, t]));
  const selectedTask = taskById.get(form.taskId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.taskId) return;
    try {
      await monitorApi.saveAnnotation({
        taskId: form.taskId,
        scenarioId: selectedTask?.scenarioId ?? null,
        referenceMeaningCode: form.referenceMeaningCode.trim() || null,
        meaningScore: form.meaningScore === '' ? null : Number(form.meaningScore),
        recipientUnderstood: form.recipientUnderstood,
        asrIssue: form.asrIssue,
        uiDifficultyCount: form.uiDifficultyCount,
        note: form.note.trim() || null,
      });
      setMsg('Saved.');
      list.refresh();
      stats.refresh();
    } catch (err) {
      setMsg(`Not saved: ${err instanceof MonitorApiError ? err.code : 'error'}`);
    }
  };

  return (
    <div className="mon-tab">
      <p className="mon-note">
        Adult-test annotations only. Technical delivery is not understanding: record here whether the meaning survived. <b>Do not type identifiable speech or personal data</b> — the note is a short observation, and the transcript itself is never stored.
      </p>
      <form className="mon-form" onSubmit={(e) => void submit(e)}>
        <label>
          Task
          <select value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })} required data-testid="ann-task">
            <option value="">— choose a recent task —</option>
            {(tasks.data?.rows ?? []).map((t) => (
              <option key={t.taskId} value={t.taskId}>
                {fmtTime(t.startedAt)} · {t.preset} · {t.direction?.replace('_TO_', '→') ?? '?'} · {t.status} · {t.taskId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reference meaning code
          <input value={form.referenceMeaningCode} maxLength={60} pattern="[A-Za-z0-9_.\-]*" placeholder="e.g. Z01" onChange={(e) => setForm({ ...form, referenceMeaningCode: e.target.value })} />
        </label>
        <label>
          Meaning preserved
          <select value={form.meaningScore} onChange={(e) => setForm({ ...form, meaningScore: e.target.value as Form['meaningScore'] })} data-testid="ann-score">
            <option value="">not scored</option>
            <option value="0">0 — lost / wrong</option>
            <option value="1">1 — partly</option>
            <option value="2">2 — preserved</option>
          </select>
        </label>
        <label>
          Recipient understood
          <select value={form.recipientUnderstood} onChange={(e) => setForm({ ...form, recipientUnderstood: e.target.value as YesNoNA })}>
            <option value="not_assessed">not assessed</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label>
          ASR issue
          <select value={form.asrIssue} onChange={(e) => setForm({ ...form, asrIssue: e.target.value as YesNoNA })}>
            <option value="not_assessed">not assessed</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label>
          UI difficulty events
          <input type="number" min={0} max={100} value={form.uiDifficultyCount} onChange={(e) => setForm({ ...form, uiDifficultyCount: Number(e.target.value) })} />
        </label>
        <label className="wide">
          Note (≤ 280 chars, no identifiable speech)
          <textarea value={form.note} maxLength={280} rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <div className="wide">
          <button type="submit" disabled={!form.taskId}>
            Save annotation
          </button>{' '}
          {msg && <span role="status">{msg}</span>}
        </div>
      </form>

      <h3>Cloud vs Local — comparison from annotations</h3>
      <ErrorNote error={stats.error} />
      <table className="mon-table" data-testid="ann-stats">
        <thead>
          <tr>
            <th>Preset</th>
            <th>Direction</th>
            <th>n</th>
            <th>Mean meaning (0–2)</th>
            <th>0 / 1 / 2</th>
            <th>Understood</th>
            <th>ASR issues</th>
            <th>UI difficulty events</th>
          </tr>
        </thead>
        <tbody>
          {(stats.data?.groups ?? []).map((g) => (
            <tr key={`${g.preset}-${g.direction}`}>
              <td>{g.preset}</td>
              <td>{g.direction?.replace('_TO_', '→') ?? '—'}</td>
              <td>{g.n}</td>
              <td>{mean(g.meanMeaning)}</td>
              <td>
                {g.distribution[0]} / {g.distribution[1]} / {g.distribution[2]}
              </td>
              <td>{g.understoodAssessed ? `${g.understoodYes}/${g.understoodAssessed}` : '—'}</td>
              <td>{g.asrAssessed ? `${g.asrIssueYes}/${g.asrAssessed}` : '—'}</td>
              <td>{g.uiDifficultyTotal}</td>
            </tr>
          ))}
          {stats.data && stats.data.groups.length === 0 && (
            <tr>
              <td colSpan={8} className="mon-empty">
                No annotations yet. Small samples are descriptive only — no significance is implied.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Annotations</h3>
      <table className="mon-table small">
        <thead>
          <tr>
            <th>Updated</th>
            <th>Task</th>
            <th>Preset</th>
            <th>Environment</th>
            <th>Network</th>
            <th>Noise</th>
            <th>Test session</th>
            <th>Model config</th>
            <th>Ref</th>
            <th>Meaning</th>
            <th>Understood</th>
            <th>ASR issue</th>
            <th>UI</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {(list.data?.rows ?? []).map((a) => (
            <tr key={a.taskId}>
              <td>{fmtTime(a.updatedAt)}</td>
              <td className="mono">{a.taskId.slice(0, 8)}</td>
              <td>{a.preset ?? '—'}</td>
              <td>{a.environment ?? 'UNKNOWN'}</td>
              <td>{a.networkType ?? 'UNKNOWN'}</td>
              <td>{a.noiseLevel ?? 'UNKNOWN'}</td>
              <td className="mono">{a.testRunId ?? '—'}</td>
              <td className="mono">{a.modelConfigId ?? 'UNKNOWN'}</td>
              <td>{a.referenceMeaningCode ?? '—'}</td>
              <td>{a.meaningScore ?? '—'}</td>
              <td>{a.recipientUnderstood}</td>
              <td>{a.asrIssue}</td>
              <td>{a.uiDifficultyCount}</td>
              <td>{a.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && list.data.total > 25 && (
        <div className="mon-pager">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
            ‹ Prev
          </button>
          <button type="button" disabled={offset + 25 >= list.data.total} onClick={() => setOffset(offset + 25)}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
