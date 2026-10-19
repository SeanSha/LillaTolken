import { useEffect, useState } from 'react';
import type { TaskRow } from '@kt/shared';
import { monitorApi, type TaskDetail } from './api';
import { useMonitor } from './context';
import { DIRECTION_LABEL, fmtMs, fmtTime, fmtUsd } from './format';
import { usePolled } from './hooks';
import { costCell } from './RequestsTab';
import { Drawer, ErrorNote, KV, Pager, SortTh } from './parts';

export function taskCost(t: TaskRow): string {
  if (t.preset === 'mock') return 'N/A';
  if (t.preset === 'local') return '$0 (local)';
  if (t.requestCount === 0) return '—';
  if (t.costUnknownRequests === t.requestCount) return 'Unknown';
  return `${fmtUsd(t.costKnownUsd)}${t.costUnknownRequests ? ` + ${t.costUnknownRequests} unpriced` : ''}`;
}

export function TasksTab() {
  const { resolve, key, intervalMs, onAuthError } = useMonitor();
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('startedAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setOffset(0), [key]);

  const page = usePolled(() => monitorApi.tasks(resolve(), { limit, offset, sort, order }), [key, limit, offset, sort, order], intervalMs);
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
      <p className="mon-note">
        One row per translation TASK. Request count ≠ task count ≠ audio segments: a Chinese→Swedish task can have many segments, ASR calls, interpretation calls (clarification), one translation and several TTS prompts. Task cost is the SUM of all linked requests, retries included.
      </p>
      <ErrorNote error={page.error} />
      <div className="mon-scroll">
        <table className="mon-table" data-testid="tasks-table">
          <thead>
            <tr>
              <SortTh label="Started" field="startedAt" sort={sort} order={order} onSort={onSort} />
              <th>taskId</th>
              <th>Direction</th>
              <SortTh label="Provider" field="preset" sort={sort} order={order} onSort={onSort} />
              <th>Segments</th>
              <SortTh label="Recorded" field="recordedMs" sort={sort} order={order} onSort={onSort} />
              <th>ASR</th>
              <th>Interpret</th>
              <th>Translate</th>
              <th>TTS</th>
              <th>Clarif.</th>
              <th>Rejected</th>
              <SortTh label="Processing" field="processingMs" sort={sort} order={order} onSort={onSort} />
              <th>Elapsed</th>
              <th>Playback done</th>
              <SortTh label="Outcome" field="status" sort={sort} order={order} onSort={onSort} />
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((t) => (
              <tr key={t.taskId} onClick={() => setSelected(t.taskId)} className={t.status === 'failed' ? 'row-bad' : ''} data-testid="task-row">
                <td>{fmtTime(t.startedAt)}</td>
                <td className="mono">{t.taskId}</td>
                <td>{t.direction ? t.direction.replace('_TO_', '→') : '—'}</td>
                <td>{t.preset}</td>
                <td>{t.segmentCount}</td>
                <td>{fmtMs(t.recordedMs)}</td>
                <td>{t.asrCalls}</td>
                <td>{t.interpretCalls}</td>
                <td>{t.translateCalls}</td>
                <td>{t.ttsCalls}</td>
                <td>{t.clarificationCount}</td>
                <td>{t.confirmationRejectCount}</td>
                <td>{fmtMs(t.processingMs)}</td>
                <td>{fmtMs(t.taskElapsedMs)}</td>
                <td>{t.playbackCompleted ? `yes (${fmtMs(t.playbackMs)})` : t.deliveryMode === 'text_only' ? 'text only' : 'no'}</td>
                <td>
                  <span className={`pill ${t.status}`}>{t.status}</span>
                </td>
                <td>{taskCost(t)}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 && (
              <tr>
                <td colSpan={17} className="mon-empty">
                  No tasks match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {d && <Pager total={d.total} limit={limit} offset={offset} onChange={setOffset} onLimit={(n) => (setLimit(n), setOffset(0))} />}
      {selected && (
        <Drawer title={`Task ${selected}`} onClose={() => setSelected(null)}>
          <TaskDetailView taskId={selected} />
        </Drawer>
      )}
    </div>
  );
}

function TaskDetailView({ taskId }: { taskId: string }) {
  const detail = usePolled<TaskDetail>(() => monitorApi.taskDetail(taskId), [taskId], 4000);
  const d = detail.data;
  if (!d) return <p>{detail.error ? `Cannot load: ${detail.error.code}` : 'Loading…'}</p>;
  const t = d.task;
  return (
    <>
      <KV
        rows={[
          ['Direction', t.direction ? DIRECTION_LABEL[t.direction] : '—'],
          ['Provider (frozen)', t.preset],
          ['Outcome', `${t.status}${t.deliveryMode ? ` · ${t.deliveryMode}` : ''}`],
          ['Scenario', t.scenarioId ?? '—'],
          ['Elapsed (user pauses, prompts, playback included)', fmtMs(t.taskElapsedMs)],
          ['Backend processing (sum of request latencies)', fmtMs(t.processingMs)],
          ['Recorded audio (sum of segments)', fmtMs(t.recordedMs)],
          ['Target playback on device', t.playbackMs !== null ? fmtMs(t.playbackMs) : 'not completed'],
          ['Cost', taskCost(t)],
        ]}
      />
      <h4>Segments ({d.segments.length})</h4>
      <table className="mon-table small">
        <thead>
          <tr>
            <th>#</th>
            <th>Purpose</th>
            <th>Captured</th>
            <th>30 s timeout</th>
          </tr>
        </thead>
        <tbody>
          {d.segments.map((s) => (
            <tr key={s.segmentId}>
              <td>{s.segmentIndex + 1}</td>
              <td>{s.inputPurpose}</td>
              <td>{fmtMs(s.capturedDurationMs)}</td>
              <td>{s.hitTimeout ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Linked requests ({d.requests.length})</h4>
      <table className="mon-table small">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Latency</th>
            <th>Status</th>
            <th>Price</th>
            <th>Retry of</th>
          </tr>
        </thead>
        <tbody>
          {d.requests.map((r) => (
            <tr key={r.rid} className={r.status !== 'succeeded' ? 'row-bad' : ''}>
              <td>{r.stage}</td>
              <td>{fmtMs(r.durationMs)}</td>
              <td>{r.status === 'succeeded' ? 'ok' : `${r.status}${r.errorCode ? ` · ${r.errorCode}` : ''}`}</td>
              <td>{costCell(r)}</td>
              <td className="mono">{r.retryOfRid ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Event timeline (metadata only)</h4>
      <ol className="mon-timeline">
        {d.events.map((e) => (
          <li key={e.id}>
            <span>{new Date(e.ts).toLocaleTimeString()}</span> {e.eventType}
            {e.stage ? ` · ${e.stage}` : ''}
            {e.stageDurationMs !== null ? ` · ${fmtMs(e.stageDurationMs)}` : ''}
            {e.errorCategory ? ` · ${e.errorCategory}` : ''}
          </li>
        ))}
      </ol>
    </>
  );
}
