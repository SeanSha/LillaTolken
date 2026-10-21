import { useEffect, useState, type FormEvent } from 'react';
import type { ComparisonResponse, ConditionComparison, ConditionModelSplit, ModelConfig, TestRun } from '@kt/shared';
import { MonitorApiError, monitorApi } from './api';
import { useMonitor } from './context';
import { fmtMs, fmtTime, fmtUsd } from './format';
import { usePolled } from './hooks';
import { ErrorNote } from './parts';

type Draft = {
  label: string;
  environment: '' | 'HOME' | 'OUTDOOR';
  networkType: '' | 'WIFI' | 'CELLULAR' | 'UNKNOWN';
  noiseLevel: '' | 'QUIET' | 'MODERATE' | 'NOISY' | 'UNKNOWN';
  notes: string;
};

const EMPTY: Draft = { label: '', environment: '', networkType: '', noiseLevel: '', notes: '' };

function joinUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function configLine(c: ModelConfig | null): string {
  if (!c) return 'UNKNOWN';
  const voice = c.ttsVoice ? ` · voice ${c.ttsVoice}` : '';
  return `${c.preset}: ASR ${c.asrProvider}/${c.asrModel}; interpret ${c.interpretProvider}/${c.interpretModel}; translate ${c.translateProvider}/${c.translateModel}; TTS ${c.ttsProvider}/${c.ttsModel}${voice}`;
}

function distText(d: { count: number; medianMs: number | null; p90Ms: number | null }, p90Min: number): string {
  if (d.count === 0) return '— (n=0)';
  const p90 = d.p90Ms === null ? `— (n=${d.count}, need ${p90Min} for P90)` : `${fmtMs(d.p90Ms)} (n=${d.count})`;
  const median = d.medianMs === null ? '—' : fmtMs(d.medianMs);
  return `median ${median} · P90 ${p90}`;
}

function costText(s: { costKnownUsd: number; costEstimatedUsd: number; costUnknownRequests: number; cloudRequests: number }): string {
  if (s.cloudRequests === 0) return 'no cloud API requests';
  const estimated = s.costEstimatedUsd > 0 ? `; estimated ${fmtUsd(s.costEstimatedUsd)} of that known total` : '';
  return `known ${fmtUsd(s.costKnownUsd)}${estimated}; unknown requests ${s.costUnknownRequests}`;
}

export function TestSessionsTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runs = usePolled(() => monitorApi.testRuns(), [], intervalMs);
  const comparison = usePolled(() => monitorApi.comparison(resolve()), [key], intervalMs);
  useEffect(() => {
    if (runs.error?.status === 401 || comparison.error?.status === 401) onAuthError();
  }, [runs.error, comparison.error, onAuthError]);

  const ready = draft.label.trim() !== '' && draft.environment !== '' && draft.networkType !== '' && draft.noiseLevel !== '';

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || draft.environment === '' || draft.networkType === '' || draft.noiseLevel === '') return;
    setBusy(true);
    setMsg(null);
    try {
      const created = await monitorApi.createTestRun({
        label: draft.label.trim(),
        environment: draft.environment,
        networkType: draft.networkType,
        noiseLevel: draft.noiseLevel,
        notes: draft.notes.trim() || null,
      });
      setDraft(EMPTY);
      setMsg(`Started ${created.run.code}. Open the link on the iPhone.`);
      runs.refresh();
    } catch (err) {
      setMsg(err instanceof MonitorApiError ? err.code : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  };

  const end = async (run: TestRun) => {
    if (!window.confirm(`End “${run.label}” (${run.code})? Phones that still have this code will no longer attach new tasks to it.`)) return;
    try {
      await monitorApi.endTestRun(run.testRunId);
      runs.refresh();
    } catch (err) {
      setMsg(err instanceof MonitorApiError ? err.code : 'Could not end the session.');
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('Link copied.');
    } catch {
      setMsg(url);
    }
  };

  return (
    <div className="mon-tab">
      <p className="mon-note">
        Each test session has its own code. The iPhone joins by opening that link. There is no single global active session, so two phones are not assigned each other’s conditions. Research settings stay off the child screen. Changing a session affects only tasks that start afterwards.
      </p>
      <form className="mon-form" onSubmit={(e) => void start(e)}>
        <label>
          Test label
          <input value={draft.label} maxLength={80} required onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. park, afternoon" />
        </label>
        <label>
          Environment
          <select value={draft.environment} required onChange={(e) => setDraft({ ...draft, environment: e.target.value as Draft['environment'] })}>
            <option value="">choose</option>
            <option value="HOME">HOME</option>
            <option value="OUTDOOR">OUTDOOR</option>
          </select>
        </label>
        <label>
          Network type
          <select value={draft.networkType} required onChange={(e) => setDraft({ ...draft, networkType: e.target.value as Draft['networkType'] })}>
            <option value="">choose</option>
            <option value="WIFI">WIFI</option>
            <option value="CELLULAR">CELLULAR</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
        <label>
          Noise level
          <select value={draft.noiseLevel} required onChange={(e) => setDraft({ ...draft, noiseLevel: e.target.value as Draft['noiseLevel'] })}>
            <option value="">choose</option>
            <option value="QUIET">QUIET</option>
            <option value="MODERATE">MODERATE</option>
            <option value="NOISY">NOISY</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
        <label className="wide">
          Observation notes (optional, no identifiable speech)
          <textarea value={draft.notes} maxLength={500} rows={2} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </label>
        <div className="wide">
          <button type="submit" disabled={!ready || busy}>
            Start test session
          </button>{' '}
          {msg && <span role="status">{msg}</span>}
        </div>
      </form>

      <h3>Sessions</h3>
      <ErrorNote error={runs.error} />
      <div className="mon-scroll">
        <table className="mon-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Label</th>
              <th>Code</th>
              <th>Environment</th>
              <th>Network</th>
              <th>Noise</th>
              <th>Status</th>
              <th>Phone last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(runs.data?.runs ?? []).map((run) => {
              const url = joinUrl(`/?eval=${run.code}`);
              return (
                <tr key={run.testRunId}>
                  <td>{fmtTime(run.startedAt)}</td>
                  <td>{run.label}</td>
                  <td className="mono">{run.code}</td>
                  <td>{run.environment}</td>
                  <td>{run.networkType}</td>
                  <td>{run.noiseLevel}</td>
                  <td>
                    <span className={`pill ${run.status === 'active' ? 'active' : 'cancelled'}`}>{run.status}</span>
                  </td>
                  <td>{fmtTime(run.lastSeenAt)}</td>
                  <td>
                    <button type="button" onClick={() => void copy(url)}>
                      Copy iPhone link
                    </button>
                    {run.status === 'active' && (
                      <button type="button" onClick={() => void end(run)}>
                        End
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {runs.data && runs.data.runs.length === 0 && (
              <tr>
                <td colSpan={9} className="mon-empty">
                  No test sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(runs.data?.runs ?? []).some((r) => r.notes) && (
        <ul className="mon-note">
          {(runs.data?.runs ?? [])
            .filter((r) => r.notes)
            .map((r) => (
              <li key={r.testRunId}>
                <b>{r.label}:</b> {r.notes}
              </li>
            ))}
        </ul>
      )}

      <h3>Environment comparison</h3>
      <p className="mon-note">
        Side-by-side HOME + WIFI and OUTDOOR + CELLULAR. Sample sizes are shown. A blank latency means the value was not computed, not that it was zero. HTTP round-trip time is separate from model processing time.
      </p>
      <p>
        <a className="mon-btn" href={monitorApi.exportUrl('comparison', resolve())}>
          Export comparison CSV
        </a>
        <a className="mon-btn" href={monitorApi.exportUrl('test-runs', resolve())}>
          Export test sessions CSV
        </a>
      </p>
      <ErrorNote error={comparison.error} />
      {comparison.data && (
        <>
          <p className="mon-note">{comparison.data.note}</p>
          <div className="mon-compare">
            <ConditionCard column={comparison.data.homeWifi} report={comparison.data} />
            <ConditionCard column={comparison.data.outdoorCellular} report={comparison.data} />
          </div>
        </>
      )}
    </div>
  );
}

function ConditionCard({ column, report }: { column: ConditionComparison; report: ComparisonResponse }) {
  return (
    <section className="mon-card">
      <h4>{column.label}</h4>
      <p className="mon-card-hint">
        tasks {column.taskCount} · requests {column.requestCount} · delivered {column.tasksDelivered} · failed {column.tasksFailed} · cancelled {column.tasksCancelled} · active {column.tasksActive}
      </p>
      <p>Recorded audio: {column.taskCount === 0 ? '— (n=0)' : fmtMs(column.recordedAudioMs)}</p>
      <p>Cloud API cost: {costText(column)}</p>
      <p>
        <b>Application-level HTTP RTT</b> (not model latency): {distText(column.httpRtt, report.p90MinSamples)}
      </p>
      {column.configsDiffer ? (
        <p className="mon-alert warn">This condition includes {column.splits.length} model configurations. Latency is not combined across them.</p>
      ) : (
        <>
          <p>Task completion: {distText(column.taskElapsed, report.p90MinSamples)}</p>
          <StageList stages={column.stages} p90Min={report.p90MinSamples} />
        </>
      )}
      {column.splits.length === 0 && <p className="mon-note">No tasks in this condition for the current filters.</p>}
      {column.splits.map((split) => (
        <SplitBlock key={split.modelConfigId ?? 'unknown'} split={split} report={report} showLatency={column.configsDiffer} />
      ))}
    </section>
  );
}

function StageList({ stages, p90Min }: { stages: ConditionComparison['stages']; p90Min: number }) {
  return (
    <ul className="mon-note">
      {stages.map((s) => (
        <li key={s.stage}>
          {s.stage} latency: {distText(s, p90Min)}
        </li>
      ))}
    </ul>
  );
}

function SplitBlock({ split, report, showLatency }: { split: ConditionModelSplit; report: ComparisonResponse; showLatency: boolean }) {
  const differs = split.requestModels.filter((m) => {
    const cfg = split.config;
    if (!cfg) return true;
    const expected = m.stage === 'ASR' ? cfg.asrModel : m.stage === 'TTS' ? cfg.ttsModel : m.stage === 'INTERPRET' ? cfg.interpretModel : cfg.translateModel;
    return m.modelTag !== expected;
  });
  return (
    <div>
      <p>
        <b>Model configuration</b> {split.modelConfigId ?? 'UNKNOWN'}
        <br />
        {configLine(split.config)}
      </p>
      <p className="mon-card-hint">
        n tasks {split.taskCount} · n requests {split.requestCount} · delivered {split.tasksDelivered} · failed {split.tasksFailed}
      </p>
      {showLatency && (
        <>
          <p>Task completion: {distText(split.taskElapsed, report.p90MinSamples)}</p>
          <StageList stages={split.stages} p90Min={report.p90MinSamples} />
        </>
      )}
      <p>Recorded audio: {fmtMs(split.recordedAudioMs)} · Cloud cost: {costText(split)}</p>
      {split.requestVoices.length > 0 && <p>TTS voices on requests: {split.requestVoices.join(', ')}</p>}
      {differs.length > 0 && (
        <p>
          Request models that differ from this configuration:{' '}
          {differs.map((m) => `${m.stage} ${m.modelTag} (n=${m.requests})`).join('; ')}
        </p>
      )}
    </div>
  );
}
