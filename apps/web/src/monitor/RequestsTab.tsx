import { useEffect, useState } from 'react';
import type { AiRequestRow } from '@kt/shared';
import { monitorApi } from './api';
import { useMonitor } from './context';
import { DIRECTION_LABEL, fmtInt, fmtMs, fmtTime, fmtUsd } from './format';
import { usePolled } from './hooks';
import { Drawer, ErrorNote, KV, Pager, SortTh } from './parts';

const BASIS_LABEL: Record<string, string> = {
  reported_usage: 'reported usage',
  estimated: 'estimated',
  unknown: 'unknown',
  not_applicable: 'n/a',
};

/** What the price column shows: Unknown never becomes $0.00; local is a true $0; mock is N/A. */
export function costCell(r: Pick<AiRequestRow, 'preset' | 'costUsd' | 'costBasis'>): string {
  if (r.preset === 'mock') return 'N/A';
  if (r.preset === 'local') return '$0 (local)';
  return fmtUsd(r.costUsd, 6); // single calls cost fractions of a cent
}

export function RequestsTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('startedAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<AiRequestRow | null>(null);
  useEffect(() => setOffset(0), [key]);

  const page = usePolled(() => monitorApi.requests(resolve(), { limit, offset, sort, order }), [key, limit, offset, sort, order], intervalMs);
  useEffect(() => {
    if (page.error?.status === 401) onAuthError();
  }, [page.error, onAuthError]);

  const onSort = (field: string) => {
    if (sort === field) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(field);
      setOrder('desc');
    }
  };
  const d = page.data;

  return (
    <div className="mon-tab">
      <p className="mon-note">One row per REAL backend model call (not per task). Click a row for the duration breakdown and pricing inputs. No audio, transcript, prompt or translation is stored.</p>
      <ErrorNote error={page.error} />
      <div className="mon-scroll">
        <table className="mon-table" data-testid="requests-table">
          <thead>
            <tr>
              <SortTh label="Time" field="startedAt" sort={sort} order={order} onSort={onSort} />
              <th>requestId</th>
              <th>taskId</th>
              <th>Provider</th>
              <SortTh label="Stage" field="stage" sort={sort} order={order} onSort={onSort} />
              <SortTh label="Engine / model" field="modelTag" sort={sort} order={order} onSort={onSort} />
              <th>Direction</th>
              <th>Input rec. (s)</th>
              <SortTh label="Latency" field="durationMs" sort={sort} order={order} onSort={onSort} />
              <SortTh label="Status" field="status" sort={sort} order={order} onSort={onSort} />
              <th>Tokens in/out</th>
              <SortTh label="Price USD" field="costUsd" sort={sort} order={order} onSort={onSort} />
              <th>Price basis</th>
              <th>Model load</th>
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((r) => (
              <tr key={r.rid} onClick={() => setSelected(r)} className={r.status !== 'succeeded' ? 'row-bad' : ''} data-testid="request-row">
                <td>{fmtTime(r.startedAt)}</td>
                <td className="mono">{r.requestId}</td>
                <td className="mono">{r.taskId}</td>
                <td>{r.preset}</td>
                <td>{r.stage}</td>
                <td className="mono">{r.modelTag}</td>
                <td>{r.direction ? r.direction.replace('_TO_', '→') : '—'}</td>
                <td>{r.inputAudioMs !== null ? (r.inputAudioMs / 1000).toFixed(1) : '—'}</td>
                <td>{fmtMs(r.durationMs)}</td>
                <td>{r.status === 'succeeded' ? 'ok' : `${r.status}${r.errorCode ? ` · ${r.errorCode}` : ''}`}</td>
                <td>
                  {fmtInt(r.promptTokens)} / {fmtInt(r.outputTokens)}
                </td>
                <td>{costCell(r)}</td>
                <td>{BASIS_LABEL[r.costBasis]}</td>
                <td>{fmtMs(r.modelLoadMs)}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 && (
              <tr>
                <td colSpan={14} className="mon-empty">
                  No requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {d && <Pager total={d.total} limit={limit} offset={offset} onChange={setOffset} onLimit={(n) => (setLimit(n), setOffset(0))} />}

      {selected && (
        <Drawer title={`Request ${selected.stage} · ${selected.rid}`} onClose={() => setSelected(null)}>
          <RequestDetail r={selected} />
        </Drawer>
      )}
    </div>
  );
}

function RequestDetail({ r }: { r: AiRequestRow }) {
  const parts: Array<[string, number | null, string]> = [
    ['Wall-clock (Node timer)', r.durationMs, '#4c8bf5'],
    ['Conversion (ffmpeg)', r.conversionMs, '#f59e0b'],
    ['Engine compute', r.engineInferenceMs, '#10b981'],
    ['Model load (cold start)', r.modelLoadMs, '#ef4444'],
  ];
  const max = Math.max(...parts.map(([, v]) => v ?? 0), 1);
  return (
    <>
      <h4>Duration breakdown</h4>
      <div className="mon-bars">
        {parts.map(([label, v, color]) => (
          <div key={label}>
            <span>{label}</span>
            <div className="bar">
              <i style={{ width: `${((v ?? 0) / max) * 100}%`, background: color }} />
            </div>
            <b>{fmtMs(v)}</b>
          </div>
        ))}
      </div>
      <p className="mon-note">Engine compute / conversion / model load are sub-steps reported by the adapter; they are never substituted for the wall-clock latency. Ollama engine compute excludes its model-load time.</p>
      <KV
        rows={[
          ['Provider / model', `${r.providerName} · ${r.modelTag}`],
          ['Started', fmtTime(r.startedAt)],
          ['Direction', r.direction ? DIRECTION_LABEL[r.direction] : '—'],
          ['Status', `${r.status}${r.errorCode ? ` (${r.errorCode})` : ''}`],
          ['Input audio', r.inputAudioMs !== null ? `${(r.inputAudioMs / 1000).toFixed(2)} s` : '—'],
          ['Generated audio', r.outputAudioMs !== null ? `${(r.outputAudioMs / 1000).toFixed(2)} s (media length, not processing time)` : '—'],
          ['Tokens (prompt / cached / output)', `${fmtInt(r.promptTokens)} / ${fmtInt(r.cachedPromptTokens)} / ${fmtInt(r.outputTokens)}`],
          ['Call # under this requestId', r.callIndex],
          ['Retry of', r.retryOfRid ?? '—'],
          ['taskId', <span className="mono" key="t">{r.taskId}</span>],
        ]}
      />
      <h4>Pricing</h4>
      <KV
        rows={[
          ['Price', costCell(r)],
          ['Basis', BASIS_LABEL[r.costBasis] ?? r.costBasis],
          ['Price revision', r.priceRevision ?? '—'],
          ['Method', r.costDetail?.method ?? '—'],
          ['Unit', r.costDetail?.unit ?? '—'],
          ['Rates used', r.costDetail ? JSON.stringify(r.costDetail.rates) : '—'],
          ['Quantities', r.costDetail ? JSON.stringify(r.costDetail.quantities) : '—'],
          ['Note', r.costDetail?.note ?? '—'],
        ]}
      />
    </>
  );
}
