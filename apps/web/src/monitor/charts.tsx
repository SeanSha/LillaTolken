// Minimal dependency-free SVG charts (counts / cost / latency only; no dashboards SaaS).
import type { ReactNode } from 'react';

export type Series = { name: string; color: string; values: Array<number | null> };

const W = 520;
const H = 150;
const PAD = { l: 44, r: 8, t: 8, b: 22 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function Frame({ title, children, legend }: { title: string; children: ReactNode; legend?: ReactNode }) {
  return (
    <figure className="mon-chart">
      <figcaption>{title}</figcaption>
      {children}
      {legend && <div className="mon-legend">{legend}</div>}
    </figure>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <Frame title={title}>
      <div className="mon-empty">No data in this range yet.</div>
    </Frame>
  );
}

const shortLabel = (iso: string, bucket: 'hour' | 'day') => {
  const d = new Date(iso);
  return bucket === 'day' ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function BarChart({ title, labels, values, color = '#4c8bf5', format = (v: number) => String(v), bucket }: {
  title: string;
  labels: string[];
  values: number[];
  color?: string;
  format?: (v: number) => string;
  bucket: 'hour' | 'day';
}) {
  if (values.length === 0 || values.every((v) => v === 0)) return <Empty title={title} />;
  const max = niceMax(Math.max(...values));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const bw = Math.min(36, (plotW / values.length) * 0.7);
  const step = plotW / values.length;
  const labelEvery = Math.max(1, Math.ceil(values.length / 8));
  return (
    <Frame title={title}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + plotH * (1 - t)} y2={PAD.t + plotH * (1 - t)} stroke="#e3e6ec" />
            <text x={PAD.l - 4} y={PAD.t + plotH * (1 - t) + 3} fontSize="9" textAnchor="end" fill="#667085">
              {format(max * t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = (v / max) * plotH;
          const x = PAD.l + step * i + (step - bw) / 2;
          return (
            <g key={labels[i]}>
              <rect x={x} y={PAD.t + plotH - h} width={bw} height={Math.max(h, v > 0 ? 1 : 0)} fill={color} rx="2">
                <title>{`${shortLabel(labels[i]!, bucket)}: ${format(v)}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 6} fontSize="9" textAnchor="middle" fill="#667085">
                  {shortLabel(labels[i]!, bucket)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}

/** Bars whose labels are already display text (a latency histogram), not timestamps. */
export function CategoryChart({ title, labels, series, format = (v: number) => String(v) }: {
  title: string;
  labels: string[];
  series: Series[];
  format?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (labels.length === 0 || all.every((v) => v === 0)) return <Empty title={title} />;
  const max = niceMax(Math.max(...all));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const group = plotW / labels.length;
  const bw = Math.min(18, (group / Math.max(series.length, 1)) * 0.7);
  return (
    <Frame
      title={title}
      legend={series.map((s) => (
        <span key={s.name}>
          <i style={{ background: s.color }} /> {s.name}
        </span>
      ))}
    >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + plotH * (1 - t)} y2={PAD.t + plotH * (1 - t)} stroke="#e3e6ec" />
            <text x={PAD.l - 4} y={PAD.t + plotH * (1 - t) + 3} fontSize="9" textAnchor="end" fill="#667085">
              {format(max * t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label} x={PAD.l + group * i + group / 2} y={H - 6} fontSize="9" textAnchor="middle" fill="#667085">
            {label}
          </text>
        ))}
        {series.map((s, si) =>
          s.values.map((v, i) => {
            const value = v ?? 0;
            const h = (value / max) * plotH;
            const x = PAD.l + group * i + (group - bw * series.length) / 2 + si * bw;
            return (
              <rect key={`${s.name}-${labels[i]}`} x={x} y={PAD.t + plotH - h} width={bw} height={Math.max(h, value > 0 ? 1 : 0)} fill={s.color} rx="2">
                <title>{`${s.name} ${labels[i]}: ${format(value)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
    </Frame>
  );
}

export function LineChart({ title, labels, series, format = (v: number) => String(Math.round(v)), bucket }: {
  title: string;
  labels: string[];
  series: Series[];
  format?: (v: number) => string;
  bucket: 'hour' | 'day';
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (labels.length === 0 || all.length === 0) return <Empty title={title} />;
  const max = niceMax(Math.max(...all));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const y = (v: number) => PAD.t + plotH * (1 - v / max);
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <Frame
      title={title}
      legend={series.map((s) => (
        <span key={s.name}>
          <i style={{ background: s.color }} /> {s.name}
        </span>
      ))}
    >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + plotH * (1 - t)} y2={PAD.t + plotH * (1 - t)} stroke="#e3e6ec" />
            <text x={PAD.l - 4} y={PAD.t + plotH * (1 - t) + 3} fontSize="9" textAnchor="end" fill="#667085">
              {format(max * t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={l} x={x(i)} y={H - 6} fontSize="9" textAnchor="middle" fill="#667085">
              {shortLabel(l, bucket)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : { px: x(i), py: y(v), v, i }));
          const path = pts
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .map((p, k) => `${k === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`)
            .join(' ');
          return (
            <g key={s.name}>
              <path d={path} fill="none" stroke={s.color} strokeWidth="2" />
              {pts.map((p) =>
                p ? (
                  <circle key={p.i} cx={p.px} cy={p.py} r="3" fill={s.color}>
                    <title>{`${s.name} ${shortLabel(labels[p.i]!, bucket)}: ${format(p.v)}`}</title>
                  </circle>
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}
