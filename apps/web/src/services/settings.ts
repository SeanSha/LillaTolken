import { useSyncExternalStore } from 'react';
import { readCloudAcknowledged, writeCloudAcknowledged } from './presetPreference';

export type MicMode = 'auto' | 'real' | 'simulated';

export type Settings = {
  /** `auto`: simulated microphone for the mock preset, real microphone otherwise. */
  micMode: MicMode;
  mockScenarioId: string;
  /** Free-text label stored with evaluation events (non-identifying!). */
  scenarioId: string;
  /** Tester ticked "adult / synthetic input only" for the cloud preset. */
  cloudAcknowledged: boolean;
};

const DEFAULTS: Settings = { micMode: 'auto', mockScenarioId: 'T01', scenarioId: '', cloudAcknowledged: true };

let state: Settings = { ...DEFAULTS, cloudAcknowledged: readCloudAcknowledged() };
const listeners = new Set<() => void>();

export const settings = {
  get: (): Settings => state,
  set(patch: Partial<Settings>): void {
    state = { ...state, ...patch };
    if (patch.cloudAcknowledged !== undefined) writeCloudAcknowledged(state.cloudAcknowledged);
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get, settings.get);
}
