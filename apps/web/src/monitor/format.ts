export const fmtMs = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 60_000) return `${(v / 60_000).toFixed(1)} min`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
};

/** Unknown is NEVER shown as $0.00. */
export const fmtUsd = (v: number | null | undefined, digits = 4): string => (v === null || v === undefined ? 'Unknown' : `$${v.toFixed(digits)}`);

export const fmtInt = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : v.toLocaleString());

export const fmtMin = (v: number): string => `${v.toFixed(2)} min`;

export const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const fmtPct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export const DIRECTION_LABEL: Record<string, string> = { ZH_TO_SV: '中→瑞 ZH→SV', SV_TO_ZH: '瑞→中 SV→ZH' };
