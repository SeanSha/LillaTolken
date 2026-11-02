import { createContext, useContext } from 'react';
import type { AiFeature, AiStage, CostBasis, Direction, EvalEnvironment, EvalNetwork, EvalNoise, MonitorFilters, ProviderPreset, RequestStatus, TaskStatus } from '@kt/shared';

export type RangeKey = 'today' | '7d' | '30d' | 'all' | 'custom';
export type MonitorTab = 'overview' | 'requests' | 'tasks' | 'sessions' | 'evaluation' | 'cost';
export type RunStatus = 'active' | 'ended';

export type FilterState = {
  range: RangeKey;
  customFrom: string; // datetime-local value
  customTo: string;
  preset: '' | ProviderPreset;
  direction: '' | Direction;
  stage: '' | AiStage;
  model: string;
  /** Request status. Matches the Request Explorer Status column, not a task outcome. */
  status: '' | RequestStatus;
  /** Task Explorer Outcome column. */
  taskStatus: '' | TaskStatus;
  scenarioId: string;
  environment: '' | EvalEnvironment;
  networkType: '' | EvalNetwork;
  noiseLevel: '' | EvalNoise;
  /** Test-sessions table only. Not sent to the API. */
  runStatus: '' | RunStatus;
  testRunId: string;
  modelConfigId: string;
  feature: '' | AiFeature;
  costBasis: '' | CostBasis;
};

/** Which filter controls belong on each tab, following that tab's table columns. */
const TAB_FIELDS: Record<MonitorTab, ReadonlyArray<keyof FilterState>> = {
  overview: ['range', 'preset', 'direction', 'stage', 'model', 'status', 'scenarioId'],
  requests: ['range', 'preset', 'feature', 'stage', 'model', 'direction', 'status', 'costBasis'],
  tasks: ['range', 'preset', 'direction', 'environment', 'networkType', 'noiseLevel', 'taskStatus'],
  sessions: ['range', 'preset', 'direction', 'stage', 'model', 'status', 'environment', 'networkType', 'noiseLevel', 'runStatus', 'testRunId', 'modelConfigId'],
  evaluation: ['range', 'preset', 'direction', 'environment', 'networkType', 'noiseLevel', 'testRunId', 'modelConfigId'],
  cost: ['range', 'preset', 'direction', 'feature', 'stage', 'model', 'status'],
};

export function filtersFor(tab: MonitorTab): ReadonlyArray<keyof FilterState> {
  return TAB_FIELDS[tab];
}

export const DEFAULT_FILTERS: FilterState = {
  range: 'today',
  customFrom: '',
  customTo: '',
  preset: '',
  direction: '',
  stage: '',
  model: '',
  status: '',
  taskStatus: '',
  scenarioId: '',
  environment: '',
  networkType: '',
  noiseLevel: '',
  runStatus: '',
  testRunId: '',
  modelConfigId: '',
  feature: '',
  costBasis: '',
};

/** Resolved at call time so "today" / "last 7 days" keep moving while the page polls. */
export function resolveFilters(s: FilterState, tab: MonitorTab = 'overview', now: Date = new Date()): MonitorFilters {
  const shown = new Set(filtersFor(tab));
  const f: MonitorFilters = {};
  if (shown.has('range')) {
    if (s.range === 'today') {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      f.from = midnight.toISOString();
    } else if (s.range === '7d') f.from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    else if (s.range === '30d') f.from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    else if (s.range === 'custom') {
      if (s.customFrom) f.from = new Date(s.customFrom).toISOString();
      if (s.customTo) f.to = new Date(s.customTo).toISOString();
    }
  }
  if (shown.has('preset') && s.preset) f.preset = s.preset;
  if (shown.has('direction') && s.direction) f.direction = s.direction;
  if (shown.has('stage') && s.stage) f.stage = s.stage;
  if (shown.has('model') && s.model.trim()) f.model = s.model.trim();
  if (shown.has('status') && s.status) f.status = s.status;
  if (shown.has('taskStatus') && s.taskStatus) f.taskStatus = s.taskStatus;
  if (shown.has('scenarioId') && s.scenarioId.trim()) f.scenarioId = s.scenarioId.trim();
  // The comparison keeps both environment columns. Those two filters only narrow the sessions table.
  if (tab !== 'sessions') {
    if (shown.has('environment') && s.environment) f.environment = s.environment;
    if (shown.has('networkType') && s.networkType) f.networkType = s.networkType;
  }
  if (shown.has('noiseLevel') && s.noiseLevel) f.noiseLevel = s.noiseLevel;
  if (shown.has('testRunId') && s.testRunId) f.testRunId = s.testRunId;
  if (shown.has('modelConfigId') && s.modelConfigId) f.modelConfigId = s.modelConfigId;
  if (shown.has('feature') && s.feature) f.feature = s.feature;
  if (shown.has('costBasis') && s.costBasis) f.costBasis = s.costBasis;
  return f;
}

export type MonitorCtx = {
  filters: FilterState;
  resolve: () => MonitorFilters;
  /** Stable string key of the filters: use as a hook dependency. */
  key: string;
  intervalMs: number | null;
  onAuthError: () => void;
};

export const MonitorContext = createContext<MonitorCtx | null>(null);

export function useMonitor(): MonitorCtx {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error('MonitorContext missing');
  return ctx;
}
