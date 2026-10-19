import { useEffect, useState, type FormEvent } from 'react';
import type { BudgetSettings } from '@kt/shared';
import { monitorApi } from './api';
import { useMonitor } from './context';
import { fmtInt, fmtMin, fmtUsd } from './format';
import { usePolled } from './hooks';
import { Card, ErrorNote } from './parts';

export function CostTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const summary = usePolled(() => monitorApi.summary(resolve()), [key], intervalMs);
  const pricing = usePolled(() => monitorApi.pricing(), [], null);
  const settings = usePolled(() => monitorApi.settings(), [], null);
  useEffect(() => {
    if ([summary.error, pricing.error, settings.error].some((e) => e?.status === 401)) onAuthError();
  }, [summary.error, pricing.error, settings.error, onAuthError]);

  const s = summary.data;
  const cost = s?.cost;
  const knownCloud = cost ? cost.cloudRequests - cost.cloudUnknownRequests : 0;

  return (
    <div className="mon-tab">
      <ErrorNote error={summary.error} />
      <div className="mon-cards">
        <Card
          label="Cloud — known cost"
          value={!cost || cost.cloudRequests === 0 ? 'No Cloud requests' : knownCloud === 0 ? 'Unknown' : fmtUsd(cost.cloudKnownUsd)}
          hint={cost && cost.cloudRequests > 0 ? `${knownCloud} of ${cost.cloudRequests} requests priced${cost.partial ? ' — PARTIAL total' : ''}` : undefined}
          tone={cost?.partial ? 'warn' : undefined}
        />
        <Card label="Cloud — of which estimated" value={cost ? fmtUsd(cost.cloudEstimatedUsd) : '—'} hint="vendor per-minute estimate where usage is not itemised" />
        <Card label="Cloud — unpriced requests" value={fmtInt(cost?.cloudUnknownRequests)} hint="shown beside the subtotal; never counted as $0" tone={cost && cost.cloudUnknownRequests > 0 ? 'warn' : undefined} />
        <Card label="Local API" value="$0" hint="hardware, electricity and depreciation excluded" />
      </div>
      <p className="mon-note">
        This is an attribution estimate based on the server-side price registry (not an invoice, no billing API is used). Cloud TTS is currently Unknown because the non-streaming speech endpoint reports no usage.
      </p>

      <h3>By model</h3>
      <div className="mon-scroll">
        <table className="mon-table" data-testid="model-table">
          <thead>
            <tr>
              <th>Preset</th>
              <th>Stage</th>
              <th>Model</th>
              <th>Requests</th>
              <th>Failed</th>
              <th>Prompt tok.</th>
              <th>Output tok.</th>
              <th>Audio</th>
              <th>Known USD</th>
              <th>of which estimated</th>
              <th>Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {(s?.models ?? []).map((m) => (
              <tr key={`${m.preset}-${m.stage}-${m.modelTag}`}>
                <td>{m.preset}</td>
                <td>{m.stage}</td>
                <td className="mono">{m.modelTag}</td>
                <td>{m.requests}</td>
                <td>{m.failed}</td>
                <td>{fmtInt(m.promptTokens)}</td>
                <td>{fmtInt(m.outputTokens)}</td>
                <td>{m.audioMinutes ? fmtMin(m.audioMinutes) : '—'}</td>
                <td>{m.preset === 'cloud' ? (m.requests - m.costUnknownRequests === 0 ? 'Unknown' : fmtUsd(m.costKnownUsd)) : m.preset === 'local' ? '$0' : 'N/A'}</td>
                <td>{m.preset === 'cloud' ? fmtUsd(m.costEstimatedUsd) : '—'}</td>
                <td>{m.preset === 'cloud' ? m.costUnknownRequests : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Price registry</h3>
      {pricing.data && (
        <>
          <p className="mon-note">
            Revision <b>{pricing.data.revision}</b> · effective {pricing.data.effectiveDate} · source{' '}
            <a href={pricing.data.sourceUrl} target="_blank" rel="noreferrer">
              {pricing.data.sourceUrl}
            </a>
            . Read-only here: edit <code>apps/server/config/prices.json</code> on the Mac and bump the revision.
          </p>
          <table className="mon-table small">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Stages</th>
                <th>Metric</th>
                <th>Rates</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {pricing.data.entries.map((e, i) => (
                <tr key={i}>
                  <td>{String(e.provider)}</td>
                  <td className="mono">{String(e.model)}</td>
                  <td>{Array.isArray(e.stages) ? e.stages.join(', ') : ''}</td>
                  <td>{String(e.billingMetric)}</td>
                  <td>
                    {Object.entries(e)
                      .filter(([k, v]) => /PerMTok|perMinuteUsd/.test(k) && typeof v === 'number')
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(' · ')}
                  </td>
                  <td>{String(e.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {settings.data && <BudgetForm initial={settings.data.budget} status={s?.budget} onSaved={() => summary.refresh()} />}
      <DataControls />
    </div>
  );
}

function BudgetForm({ initial, status, onSaved }: { initial: BudgetSettings; status?: { spentUsd: number; scopeLabel: string }; onSaved: () => void }) {
  const [b, setB] = useState<BudgetSettings>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await monitorApi.saveBudget(b);
      setMsg('Saved.');
      onSaved();
    } catch {
      setMsg('Not saved.');
    }
  };
  return (
    <section>
      <h3>Soft budget alert</h3>
      <form className="mon-form" onSubmit={(e) => void submit(e)}>
        <label>
          <input type="checkbox" checked={b.enabled} onChange={(e) => setB({ ...b, enabled: e.target.checked })} /> Enabled
        </label>
        <label>
          Limit (USD)
          <input type="number" min={0} step="0.01" value={b.limitUsd} onChange={(e) => setB({ ...b, limitUsd: Number(e.target.value) })} />
        </label>
        <label>
          Scope
          <select value={b.scope} onChange={(e) => setB({ ...b, scope: e.target.value as BudgetSettings['scope'] })}>
            <option value="day">per day</option>
            <option value="session">current session</option>
          </select>
        </label>
        <div className="wide">
          <button type="submit">Save</button> {msg && <span role="status">{msg}</span>}
          {status && (
            <span className="mon-note">
              {' '}
              Spent so far ({status.scopeLabel}): {fmtUsd(status.spentUsd)} (known amounts only)
            </span>
          )}
        </div>
      </form>
      <p className="mon-note">A local alert only. It does not stop requests and is not a provider-side limit; set a hard limit in the OpenAI dashboard.</p>
    </section>
  );
}

function DataControls() {
  const { resolve, onAuthError } = useMonitor();
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const clear = async () => {
    try {
      await monitorApi.clearData();
      setConfirm('');
      setMsg('All monitoring data and evaluation events deleted.');
    } catch (e) {
      if ((e as { status?: number }).status === 401) onAuthError();
      setMsg('Delete failed.');
    }
  };
  return (
    <section>
      <h3>Export &amp; data</h3>
      <p>
        {(['requests', 'tasks', 'annotations'] as const).map((t) => (
          <a key={t} className="mon-btn" href={monitorApi.exportUrl(t, resolve())} download>
            Export {t} CSV
          </a>
        ))}
      </p>
      <p className="mon-note">Exports follow the current filters and contain metadata only (no audio, transcripts, prompts, translations).</p>
      <div className="mon-danger">
        <b>Clear adult test data</b>
        <p>Deletes every request, task, event and annotation, plus the evaluation event log. Cannot be undone. Type DELETE to confirm.</p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />{' '}
        <button type="button" disabled={confirm !== 'DELETE'} onClick={() => void clear()}>
          Delete all data
        </button>
        {msg && <p role="status">{msg}</p>}
      </div>
    </section>
  );
}
