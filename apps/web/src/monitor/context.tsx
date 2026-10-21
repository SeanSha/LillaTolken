import { createContext, useContext } from 'react';
import type { AiStage, Direction, EvalEnvironment, EvalNetwork, EvalNoise, MonitorFilters, ProviderPreset } from '@kt/shared';

export type RangeKey = 'today' | '7d' | '30d' | 'all' | 'custom';

export type FilterState = {
  range: RangeKey;
  customFrom: string; // datetime-local value
  customTo: string;
  preset: '' | ProviderPreset;
  direction: '' | Direction;
  stage: '' | AiStage;
  model: string;
  status: string;
  scenarioId: string;
  environment: '' | EvalEnvironment;
  networkType: '' | EvalNetwork;
  noiseLevel: '' | EvalNoise;
  testRunId: string;
  modelConfigId: string;
};

export const DEFAULT_FILTERS: FilterState = {
  range: 'today',
  customFrom: '',
  customTo: '',
  preset: '',
  direction: '',
  stage: '',
  model: '',
  status: '',
  scenarioId: '',
  environment: '',
  networkType: '',
  noiseLevel: '',
  testRunId: '',
  modelConfigId: '',
};

/** Resolved at call time so "today" / "last 7 days" keep moving while the page polls. */
export function resolveFilters(s: FilterState, now: Date = new Date()): MonitorFilters {
  const f: MonitorFilters = {};
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
  if (s.preset) f.preset = s.preset;
  if (s.direction) f.direction = s.direction;
  if (s.stage) f.stage = s.stage;
  if (s.model.trim()) f.model = s.model.trim();
  if (s.status) f.status = s.status;
  if (s.scenarioId.trim()) f.scenarioId = s.scenarioId.trim();
  if (s.environment) f.environment = s.environment;
  if (s.networkType) f.networkType = s.networkType;
  if (s.noiseLevel) f.noiseLevel = s.noiseLevel;
  if (s.testRunId) f.testRunId = s.testRunId;
  if (s.modelConfigId) f.modelConfigId = s.modelConfigId;
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
