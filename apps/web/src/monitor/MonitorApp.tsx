import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react';
import { AI_STAGES } from '@kt/shared';
import { MonitorApiError, monitorApi } from './api';
import { CostTab } from './CostTab';
import { DEFAULT_FILTERS, MonitorContext, resolveFilters, type FilterState, type RangeKey } from './context';
import { EvaluationTab } from './EvaluationTab';
import { OverviewTab } from './OverviewTab';
import { RequestsTab } from './RequestsTab';
import { TasksTab } from './TasksTab';

/** A render bug in one tab must never blank the whole dashboard. Shows the message only (no data). */
class TabBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[monitor] render error', error.message, info.componentStack);
  }
  render() {
    if (this.state.error) return <p className="mon-error" role="alert">This tab failed to render: {this.state.error.message}</p>;
    return this.props.children;
  }
}

type Tab = 'overview' | 'requests' | 'tasks' | 'evaluation' | 'cost';
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['requests', 'Request Explorer'],
  ['tasks', 'Task Explorer'],
  ['evaluation', 'Evaluation'],
  ['cost', 'Cost & Data'],
];

export function MonitorApp() {
  const [auth, setAuth] = useState<{ authenticated: boolean; localOnly: boolean } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Monitor — Translator (adult admin)';
    monitorApi
      .session()
      .then(setAuth)
      .catch((e: unknown) => setFatal(e instanceof MonitorApiError ? e.code : 'ERROR'));
  }, []);

  if (fatal) return <main className="mon-login"><p className="mon-error">Cannot reach the backend ({fatal}). Is `npm run dev` running?</p></main>;
  if (!auth) return <main className="mon-login"><p>Loading…</p></main>;
  if (!auth.authenticated) return <Login localOnly={auth.localOnly} onDone={() => setAuth({ ...auth, authenticated: true })} />;
  return <Dashboard onLoggedOut={() => setAuth({ ...auth, authenticated: false })} />;
}

function Login({ localOnly, onDone }: { localOnly: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await monitorApi.login(password);
      setPassword('');
      onDone();
    } catch (err) {
      const code = err instanceof MonitorApiError ? err.code : 'ERROR';
      setError(
        code === 'TOO_MANY_ATTEMPTS'
          ? 'Too many attempts. Wait a minute and try again.'
          : code === 'LOCAL_ONLY'
            ? 'The monitor is restricted to this Mac (MONITOR_LOCAL_ONLY).'
            : code === 'BAD_ORIGIN'
              ? 'Request rejected (origin mismatch). Open the monitor from the same address you use for the app.'
              : 'Wrong password.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mon-login">
      <form onSubmit={(e) => void submit(e)} aria-label="Admin login">
        <h1>Monitor</h1>
        <p className="mon-note">Adult / admin area. Enter the monitor password{localOnly ? ' (this Mac only)' : ''}. It is printed once by the server on first start and kept in <code>apps/server/data/</code>, or set with MONITOR_ADMIN_PASSWORD.</p>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required data-testid="login-password" />
        </label>
        <button type="submit" disabled={busy || password === ''}>
          Sign in
        </button>
        {error && <p className="mon-error" role="alert">{error}</p>}
      </form>
    </main>
  );
}

const INTERVALS: Array<[string, number | null]> = [
  ['3 s', 3000],
  ['4 s', 4000],
  ['5 s', 5000],
  ['Paused', null],
];

function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [intervalMs, setIntervalMs] = useState<number | null>(4000);
  const [showFilters, setShowFilters] = useState(true);

  const key = JSON.stringify(filters);
  const ctx = useMemo(
    () => ({ filters, key, intervalMs, resolve: () => resolveFilters(filters), onAuthError: onLoggedOut }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, intervalMs, onLoggedOut],
  );
  const set = useCallback(<K extends keyof FilterState>(k: K, v: FilterState[K]) => setFilters((f) => ({ ...f, [k]: v })), []);

  const logout = async () => {
    await monitorApi.logout().catch(() => undefined);
    onLoggedOut();
  };

  return (
    <MonitorContext.Provider value={ctx}>
      <div className="mon-app">
        <header className="mon-header">
          <div>
            <h1>Translator Monitor</h1>
            <span className="mon-badge">adult test data only · metadata, no audio or text</span>
          </div>
          <div className="mon-header-actions">
            <label>
              Auto-refresh{' '}
              <select value={intervalMs ?? 'off'} onChange={(e) => setIntervalMs(e.target.value === 'off' ? null : Number(e.target.value))}>
                {INTERVALS.map(([label, v]) => (
                  <option key={label} value={v ?? 'off'}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setShowFilters(!showFilters)}>
              {showFilters ? 'Hide' : 'Show'} filters
            </button>
            <a href="/" className="mon-btn">
              Translator
            </a>
            <button type="button" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </header>

        {showFilters && <FilterBar filters={filters} set={set} onReset={() => setFilters(DEFAULT_FILTERS)} />}

        <nav className="mon-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <TabBoundary resetKey={tab}>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'requests' && <RequestsTab />}
          {tab === 'tasks' && <TasksTab />}
          {tab === 'evaluation' && <EvaluationTab />}
          {tab === 'cost' && <CostTab />}
        </TabBoundary>
      </div>
    </MonitorContext.Provider>
  );
}

function FilterBar({ filters, set, onReset }: { filters: FilterState; set: <K extends keyof FilterState>(k: K, v: FilterState[K]) => void; onReset: () => void }) {
  return (
    <section className="mon-filters" aria-label="Filters">
      <label>
        Range
        <select value={filters.range} onChange={(e) => set('range', e.target.value as RangeKey)}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
          <option value="custom">Custom…</option>
        </select>
      </label>
      {filters.range === 'custom' && (
        <>
          <label>
            From <input type="datetime-local" value={filters.customFrom} onChange={(e) => set('customFrom', e.target.value)} />
          </label>
          <label>
            To <input type="datetime-local" value={filters.customTo} onChange={(e) => set('customTo', e.target.value)} />
          </label>
        </>
      )}
      <label>
        Provider
        <select value={filters.preset} onChange={(e) => set('preset', e.target.value as FilterState['preset'])} data-testid="filter-preset">
          <option value="">all</option>
          <option value="cloud">cloud</option>
          <option value="local">local</option>
          <option value="mock">mock</option>
        </select>
      </label>
      <label>
        Direction
        <select value={filters.direction} onChange={(e) => set('direction', e.target.value as FilterState['direction'])}>
          <option value="">both</option>
          <option value="ZH_TO_SV">中→瑞</option>
          <option value="SV_TO_ZH">瑞→中</option>
        </select>
      </label>
      <label>
        Stage
        <select value={filters.stage} onChange={(e) => set('stage', e.target.value as FilterState['stage'])}>
          <option value="">all</option>
          {AI_STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Model
        <input value={filters.model} placeholder="substring" onChange={(e) => set('model', e.target.value)} />
      </label>
      <label>
        Status
        <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">all</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="timeout">timeout</option>
        </select>
      </label>
      <label>
        Scenario
        <input value={filters.scenarioId} placeholder="id" onChange={(e) => set('scenarioId', e.target.value)} />
      </label>
      <button type="button" onClick={onReset}>
        Reset
      </button>
    </section>
  );
}
