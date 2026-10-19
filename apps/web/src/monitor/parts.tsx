import type { ReactNode } from 'react';
import type { MonitorApiError } from './api';

export function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className={`mon-card${tone ? ` ${tone}` : ''}`}>
      <div className="mon-card-label">{label}</div>
      <div className="mon-card-value">{value}</div>
      {hint && <div className="mon-card-hint">{hint}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: MonitorApiError | null }) {
  if (!error) return null;
  return <p className="mon-error">Cannot load data: {error.code}</p>;
}

export function Pager({ total, limit, offset, onChange, onLimit }: { total: number; limit: number; offset: number; onChange: (offset: number) => void; onLimit: (limit: number) => void }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <div className="mon-pager">
      <span>
        {from}–{to} of {total}
      </span>
      <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ‹ Prev
      </button>
      <button type="button" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next ›
      </button>
      <label>
        Page size{' '}
        <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function SortTh({ label, field, sort, order, onSort }: { label: string; field: string; sort: string; order: 'asc' | 'desc'; onSort: (field: string) => void }) {
  return (
    <th className="sortable" onClick={() => onSort(field)} aria-sort={sort === field ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label} {sort === field ? (order === 'asc' ? '▲' : '▼') : ''}
    </th>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="mon-drawer" role="dialog" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button type="button" onClick={onClose} aria-label="Close">
          ✖
        </button>
      </header>
      <div className="mon-drawer-body">{children}</div>
    </aside>
  );
}

export function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="mon-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
