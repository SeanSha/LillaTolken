import { useEffect, useState } from 'react';
import type { AiStage, LatencyStats, MonitorHealthResponse, PresetSummary, ResponseLatencyReport } from '@kt/shared';
import { monitorApi } from './api';
import { BarChart, CategoryChart, LineChart } from './charts';
import { useMonitor } from './context';
import { fmtInt, fmtMin, fmtMs, fmtPct, fmtUsd } from './format';
import { usePolled } from './hooks';
import { ErrorNote, Card } from './parts';

const STAGE_COLORS: Record<AiStage, string> = { ASR: '#4c8bf5', INTERPRET: '#f59e0b', TRANSLATE: '#10b981', TTS: '#a855f7', IDENTIFY: '#ed625f' };

export function OverviewTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour');
  const summary = usePolled(() => monitorApi.summary(resolve()), [key], intervalMs);
  const series = usePolled(() => monitorApi.timeseries(resolve(), bucket), [key, bucket], intervalMs);
  // Engine probes are cheap but not free: poll health less often than the metrics.
  const health = usePolled(() => monitorApi.health(), [], intervalMs === null ? null : Math.max(10_000, intervalMs * 3));

  useEffect(() => {
    if ([summary.error, series.error, health.error].some((e) => e?.status === 401)) onAuthError();
  }, [summary.error, series.error, health.error, onAuthError]);

  const s = summary.data;
  const ts = series.data ?? [];
  const labels = ts.map((p) => p.bucket);

  return (
    <div className="mon-tab">
      <ErrorNote error={summary.error} />
      {s?.budget.enabled && (s.budget.exceeded || s.budget.nearLimit) && (
        <div className={`mon-alert ${s.budget.exceeded ? 'danger' : 'warn'}`} role="alert">
          {s.budget.exceeded ? 'Soft budget limit reached' : 'Approaching soft budget limit'}: {fmtUsd(s.budget.spentUsd)} of ${s.budget.limitUsd} ({s.budget.scopeLabel}). Local alert only — not a billing stop.
        </div>
      )}

      <div className="mon-cards">
        <Card label="Task attempts" value={fmtInt(s?.taskAttempts)} hint={s ? `${s.deliveredTasks} delivered · ${s.failedTasks} failed · ${s.cancelledTasks} cancelled · ${s.activeTasks} open` : undefined} />
        <Card label="Delivered tasks" value={fmtInt(s?.deliveredTasks)} hint="technical delivery ≠ understood" />
        <Card label="AI requests" value={fmtInt(s?.requestCount)} hint="every real model call, incl. repeats/retries" />
        <Card label="Recorded audio" value={s ? fmtMin(s.recordedAudioMinutes) : '—'} hint={s ? `${s.segmentCount} segments` : undefined} />
        <Card
          label="Cloud cost (USD)"
          value={!s ? '—' : s.cost.cloudRequests === 0 ? 'No Cloud requests' : s.cost.cloudRequests - s.cost.cloudUnknownRequests === 0 ? 'Unknown' : fmtUsd(s.cost.cloudKnownUsd)}
          hint={
            s
              ? s.cost.cloudRequests === 0
                ? 'no Cloud requests in range'
                : `${s.cost.partial ? 'PARTIAL — ' : ''}${s.cost.cloudUnknownRequests} of ${s.cost.cloudRequests} Cloud requests unpriced${s.cost.cloudEstimatedUsd > 0 ? ` · ${fmtUsd(s.cost.cloudEstimatedUsd)} is estimated` : ''}`
              : undefined
          }
          tone={s?.cost.partial ? 'warn' : undefined}
        />
        <Card label="Errors" value={s ? `${s.errorCount}` : '—'} hint={s ? `${fmtPct(s.errorRate)} of requests` : undefined} tone={s && s.errorCount > 0 ? 'warn' : undefined} />
        <Card label="Task duration" value={fmtMs(s?.taskElapsed.avgMs)} hint={s ? `median ${fmtMs(s.taskElapsed.medianMs)} · n=${s.taskElapsed.count} delivered` : undefined} />
        <Card
          label="Stage latency (avg)"
          value={fmtMs(s?.requestLatency.avgMs)}
          hint={s ? `p95 ${fmtMs(s.requestLatency.p95Ms)} — model calls, n=${s.requestLatency.count}${s.requestLatency.count < 20 ? ' (small sample)' : ''}` : undefined}
        />
        <ResponseLatencyCard report={s?.responseLatency} />
      </div>
      <p className="mon-note">
        Local API: $0 (hardware/power excluded). Mock: N/A. Cloud figures are an estimate/attribution view, not provider billing. Stage latency is per model call. Response latency is the wait from the paired input until audio actually starts, and is not averaged with stage latency. Mock is excluded unless Provider = mock.
      </p>
      {s?.responseLatency && <ResponseLatencyDetail report={s.responseLatency} />}

      <div className="mon-row">
        <h3>Charts</h3>
        <label>
          Bucket{' '}
          <select value={bucket} onChange={(e) => setBucket(e.target.value as 'hour' | 'day')}>
            <option value="hour">hourly</option>
            <option value="day">daily</option>
          </select>
        </label>
      </div>
      <div className="mon-charts">
        <BarChart title="AI requests" labels={labels} values={ts.map((p) => p.requests)} bucket={bucket} />
        <BarChart title="Estimated Cloud spend (USD, known amounts only)" labels={labels} values={ts.map((p) => p.cloudCostUsd)} color="#10b981" format={(v) => `$${v.toFixed(3)}`} bucket={bucket} />
        <LineChart
          title="Stage latency over time (avg)"
          labels={labels}
          bucket={bucket}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)}
          series={(Object.keys(STAGE_COLORS) as AiStage[]).map((st) => ({ name: st, color: STAGE_COLORS[st], values: ts.map((p) => p.avgMs[st] ?? null) }))}
        />
        <LineChart
          title="Cloud vs Local latency (avg per request)"
          labels={labels}
          bucket={bucket}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)}
          series={[
            { name: 'cloud', color: '#2563eb', values: ts.map((p) => p.byPreset.cloud?.avgMs ?? null) },
            { name: 'local', color: '#16a34a', values: ts.map((p) => p.byPreset.local?.avgMs ?? null) },
            { name: 'mock', color: '#94a3b8', values: ts.map((p) => p.byPreset.mock?.avgMs ?? null) },
          ]}
        />
        <LineChart
          title="Cloud vs Local response latency (avg until first audio)"
          labels={labels}
          bucket={bucket}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)}
          series={[
            { name: 'cloud', color: '#2563eb', values: ts.map((p) => p.responseLatencyAvgMs?.cloud ?? null) },
            { name: 'local', color: '#16a34a', values: ts.map((p) => p.responseLatencyAvgMs?.local ?? null) },
          ]}
        />
      </div>

      <h3>Stage breakdown</h3>
      <table className="mon-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Calls ok</th>
            <th>Errors</th>
            <th>Avg</th>
            <th>Median</th>
            <th>p95 (descriptive)</th>
            <th>Avg engine</th>
            <th>Avg model load</th>
            <th>Cold starts</th>
          </tr>
        </thead>
        <tbody>
          {(s?.stages ?? []).map((st) => (
            <tr key={st.stage}>
              <td>{st.stage}</td>
              <td>{st.count}</td>
              <td>{st.errors}</td>
              <td>{fmtMs(st.avgMs)}</td>
              <td>{fmtMs(st.medianMs)}</td>
              <td>{fmtMs(st.p95Ms)}</td>
              <td>{fmtMs(st.avgEngineMs)}</td>
              <td>{fmtMs(st.avgModelLoadMs)}</td>
              <td>{st.coldStarts}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By provider preset</h3>
      <table className="mon-table">
        <thead>
          <tr>
            <th>Preset</th>
            <th>Tasks</th>
            <th>Delivered</th>
            <th>Requests</th>
            <th>Errors</th>
            <th>Avg latency</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {(s?.presets ?? []).map((p) => (
            <tr key={p.preset}>
              <td>{p.preset}</td>
              <td>{p.tasks}</td>
              <td>{p.delivered}</td>
              <td>{p.requests}</td>
              <td>{p.errors}</td>
              <td>{fmtMs(p.avgMs)}</td>
              <td>{presetCost(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <HealthPanel health={health.data} error={health.error?.code} />
    </div>
  );
}

function latencyHint(stats: LatencyStats | null | undefined): string {
  if (!stats || stats.count === 0) return 'n=0 valid responses';
  return `median ${fmtMs(stats.medianMs)} · p95 ${fmtMs(stats.p95Ms)} · n=${stats.count} valid responses${stats.count < 20 ? ' (small sample)' : ''}`;
}

function ResponseLatencyCard({ report }: { report: ResponseLatencyReport | undefined }) {
  if (!report || report.headline === null) {
    const cloud = report?.cloud;
    const local = report?.local;
    return (
      <Card
        testId="response-latency"
        label="Response latency"
        value={report ? 'Cloud / Local' : '—'}
        hint={
          report
            ? `not combined · Cloud avg ${fmtMs(cloud?.avgMs)} (n=${cloud?.count ?? 0}) · Local avg ${fmtMs(local?.avgMs)} (n=${local?.count ?? 0})`
            : undefined
        }
      />
    );
  }
  return (
    <Card
      testId="response-latency"
      label="Response latency (avg)"
      value={fmtMs(report.headline.avgMs)}
      hint={latencyHint(report.headline)}
    />
  );
}

function ResponseLatencyDetail({ report }: { report: ResponseLatencyReport }) {
  const rows = [
    { label: 'All spoken responses', cloud: report.cloud, local: report.local },
    ...report.byType.map((row) => ({
      label: row.responseType === 'translation' ? 'Final translation' : row.responseType[0]!.toUpperCase() + row.responseType.slice(1),
      cloud: row.cloud,
      local: row.local,
    })),
  ];
  return (
    <section data-testid="response-latency-detail">
      <h3>Response latency</h3>
      <p className="mon-note">{report.note}</p>
      {report.unavailable > 0 && <p className="mon-note">Playbacks without a paired trigger: {report.unavailable} (omitted from the averages).</p>}
      {report.omittedTasks > 0 && <p className="mon-note">Delivered audio tasks with no paired playback-start sample: {report.omittedTasks}. Older records stay unavailable.</p>}
      <table className="mon-table">
        <thead>
          <tr>
            <th>Response</th>
            <th>Cloud avg</th>
            <th>Cloud median</th>
            <th>Cloud p95</th>
            <th>Cloud n</th>
            <th>Local avg</th>
            <th>Local median</th>
            <th>Local p95</th>
            <th>Local n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{fmtMs(row.cloud.avgMs)}</td>
              <td>{fmtMs(row.cloud.medianMs)}</td>
              <td>{fmtMs(row.cloud.p95Ms)}</td>
              <td>{row.cloud.count}</td>
              <td>{fmtMs(row.local.avgMs)}</td>
              <td>{fmtMs(row.local.medianMs)}</td>
              <td>{fmtMs(row.local.p95Ms)}</td>
              <td>{row.local.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mon-charts mon-charts-fit">
        <CategoryChart
          title="Response latency distribution (valid responses)"
          labels={report.buckets.map((b) => b.label)}
          series={[
            { name: 'cloud', color: '#2563eb', values: report.buckets.map((b) => b.cloud) },
            { name: 'local', color: '#16a34a', values: report.buckets.map((b) => b.local) },
          ]}
        />
      </div>
    </section>
  );
}

function presetCost(p: PresetSummary): string {
  if (p.preset === 'mock') return 'N/A';
  if (p.preset === 'local') return p.requests ? 'Local API: $0 (hardware/power excluded)' : '—';
  if (p.requests === 0) return '—';
  if (p.costUnknownRequests === p.requests) return 'Unknown';
  return `${fmtUsd(p.costKnownUsd)}${p.costUnknownRequests ? ` + ${p.costUnknownRequests} unpriced` : ''}`;
}

function HealthPanel({ health, error }: { health: MonitorHealthResponse | null; error?: string }) {
  const engine = (name: string, e: MonitorHealthResponse['local']['asr']) => (
    <li key={name} data-testid={`health-${name.toLowerCase()}`}>
      <span className={`dot ${e.ok ? 'ok' : 'bad'}`} /> <b>{name}</b> {e.modelTag ?? ''}
      {!e.ok && (
        <em>
          {' '}
          — {e.code}: {e.detail}
        </em>
      )}
      {e.ok && e.detail && <em> — {e.detail}</em>}
    </li>
  );
  return (
    <section className="mon-health">
      <h3>Health</h3>
      {error && <p className="mon-error">Health unavailable: {error}</p>}
      {health && (
        <div className="mon-health-grid">
          <div>
            <h4>
              Local (Mac) — <span data-testid="local-status">{health.local.status}</span>
            </h4>
            <ul>
              {engine('ASR', health.local.asr)}
              {engine('LLM', health.local.llm)}
              {engine('Vision', health.local.vision)}
              {engine('TTS', health.local.tts)}
            </ul>
            {health.local.lastError && (
              <p className="mon-note">
                Last engine error: {health.local.lastError.code} at {new Date(health.local.lastError.at).toLocaleTimeString()}
              </p>
            )}
          </div>
          <div>
            <h4>Cloud adapter</h4>
            <p>
              <span className={`dot ${health.cloud.configured ? 'ok' : 'bad'}`} /> {health.cloud.configured ? 'configured' : 'not configured'} <br />
              <small>{health.cloud.modelTag}</small>
            </p>
            <p className="mon-note">Checked without any billable call. The key is never shown.</p>
          </div>
        </div>
      )}
    </section>
  );
}
