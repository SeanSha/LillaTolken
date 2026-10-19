// Typed client for the protected monitoring API. Same-origin fetch; the admin session lives in an
// HttpOnly cookie, so no password or token ever touches JS storage or a URL.
import type {
  AiRequestRow,
  AnnotationRow,
  AnnotationStats,
  BudgetSettings,
  EventRow,
  MonitorFilters,
  MonitorHealthResponse,
  Page,
  PricingResponse,
  SegmentRow,
  SummaryResponse,
  TaskRow,
  TimeseriesPoint,
} from '@kt/shared';

export class MonitorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new MonitorApiError(0, 'SERVER_UNREACHABLE');
  }
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      // keep status-derived code
    }
    throw new MonitorApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function toQuery(filters: MonitorFilters, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export type PageQuery = { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc' };

export type TaskDetail = { task: TaskRow; requests: AiRequestRow[]; segments: SegmentRow[]; events: EventRow[] };

export const monitorApi = {
  session: () => call<{ authenticated: boolean; localOnly: boolean }>('/api/monitor/session'),
  login: (password: string) => call<{ authenticated: boolean }>('/api/monitor/login', json('POST', { password })),
  logout: () => call<{ authenticated: boolean }>('/api/monitor/logout', { method: 'POST' }),
  summary: (f: MonitorFilters) => call<SummaryResponse>(`/api/monitor/summary${toQuery(f)}`),
  timeseries: (f: MonitorFilters, bucket: 'hour' | 'day') => call<TimeseriesPoint[]>(`/api/monitor/timeseries${toQuery(f, { bucket })}`),
  health: () => call<MonitorHealthResponse>('/api/monitor/health'),
  requests: (f: MonitorFilters, p: PageQuery) => call<Page<AiRequestRow>>(`/api/monitor/requests${toQuery(f, { ...p })}`),
  tasks: (f: MonitorFilters, p: PageQuery) => call<Page<TaskRow>>(`/api/monitor/tasks${toQuery(f, { ...p })}`),
  taskDetail: (taskId: string) => call<TaskDetail>(`/api/monitor/tasks/${encodeURIComponent(taskId)}`),
  pricing: () => call<PricingResponse>('/api/monitor/pricing'),
  settings: () => call<{ budget: BudgetSettings }>('/api/monitor/settings'),
  saveBudget: (budget: BudgetSettings) => call('/api/monitor/settings', json('POST', { budget })),
  annotations: (f: MonitorFilters, p: PageQuery) => call<Page<AnnotationRow>>(`/api/monitor/annotations${toQuery(f, { ...p })}`),
  annotationStats: (f: MonitorFilters) => call<AnnotationStats>(`/api/monitor/annotations/stats${toQuery(f)}`),
  saveAnnotation: (a: Record<string, unknown>) => call<void>('/api/monitor/annotations', json('POST', a)),
  clearData: () => call<void>('/api/monitor/data', json('DELETE', { confirm: 'DELETE' })),
  exportUrl: (type: 'requests' | 'tasks' | 'annotations', f: MonitorFilters) => `/api/monitor/export${toQuery(f, { type, format: 'csv' })}`,
};
