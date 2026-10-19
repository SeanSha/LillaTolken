import { vi } from 'vitest';
import { createActor, SimulatedClock, waitFor } from 'xstate';
import {
  AppError,
  type ProviderBundle,
  type ProviderPreset,
  type AudioData,
  type DialogueModel,
  type SpeechRecognizer,
  type SpeechSynthesizer,
} from '@kt/shared';
import { AudioStore } from '../../apps/web/src/audio/audioStore';
import { ScriptedRecorder } from '../../apps/web/src/audio/recorder';
import { createDialogueMachine } from '../../apps/web/src/dialogue/machine';
import type { DialogueEvent, LogFields, Recorder } from '../../apps/web/src/dialogue/types';
import { createMockProvider } from '../../apps/server/src/providers/mock';

export class ListSource {
  private i = 0;
  constructor(private readonly items: string[]) {}
  next(): string {
    return this.items[this.i++] ?? '[EMPTY]';
  }
}

export type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type HarnessOptions = {
  utterances?: string[];
  preset?: ProviderPreset;
  /** Replace individual providers of the default mock bundle for ALL presets. */
  asr?: SpeechRecognizer;
  dialogue?: DialogueModel;
  tts?: SpeechSynthesizer;
  /** Provide a bundle per preset (overrides the above for that preset). */
  bundles?: Partial<Record<ProviderPreset, ProviderBundle>>;
  recorder?: Recorder;
  clock?: SimulatedClock;
};

export function createHarness(opts: HarnessOptions = {}) {
  const logs: LogFields[] = [];
  const audioStore = new AudioStore();
  const clock = opts.clock ?? new SimulatedClock();
  const base = createMockProvider();
  const defaultBundle: ProviderBundle = {
    asr: opts.asr ?? base.asr,
    dialogue: opts.dialogue ?? base.dialogue,
    tts: opts.tts ?? base.tts,
  };
  let counter = 0;
  const speakPrompt = vi.fn(async () => undefined);
  const recorder = opts.recorder ?? new ScriptedRecorder(new ListSource(opts.utterances ?? []));
  const cancelSpy = vi.spyOn(recorder, 'cancel');

  const deps = {
    providers: (preset: ProviderPreset) => opts.bundles?.[preset] ?? defaultBundle,
    recorder,
    audioStore,
    speakPrompt,
    stopSpeaking: vi.fn(),
    stopPlayback: vi.fn(),
    log: (f: LogFields) => logs.push(f),
    newId: () => `id${++counter}`,
    now: () => Date.now(),
  };
  const machine = createDialogueMachine(deps);
  const actor = createActor(machine, { clock, input: { sessionId: 'session-1', preset: opts.preset ?? 'mock' } });
  actor.start();

  const ctx = () => actor.getSnapshot().context;
  const task = () => {
    const t = ctx().task;
    if (!t) throw new Error('no task');
    return t;
  };
  const send = (event: DialogueEvent) => actor.send(event);
  const is = (path: string) => actor.getSnapshot().matches(path as never);
  const until = async (path: string, timeout = 2000) => {
    try {
      await waitFor(actor, (s) => s.matches(path as never), { timeout });
    } catch {
      throw new Error(`Expected state "${path}" but machine is at ${JSON.stringify(actor.getSnapshot().value)}`);
    }
  };
  /** Waits for the recorder to be live, then stops the segment (one spoken fragment). */
  const recordSegment = async () => {
    await until('task.recording.listening');
    send({ type: 'STOP_SEGMENT' });
    await until('task.segmentDecision');
  };
  /** Record one segment and submit it. */
  const speak = async () => {
    await recordSegment();
    send({ type: 'FINISH_INPUT' });
  };
  const eventTypes = () => logs.map((l) => l.eventType);
  const count = (type: string) => logs.filter((l) => l.eventType === type).length;

  return { actor, machine, deps, logs, audioStore, clock, recorder, cancelSpy, speakPrompt, ctx, task, send, is, until, recordSegment, speak, eventTypes, count };
}

export type Harness = ReturnType<typeof createHarness>;

/** Drive a clear ZH->SV task to the confirmation screen. */
export async function toConfirming(h: Harness) {
  h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
  await h.speak();
  await h.until('task.confirming.asking');
}

/** Complete a full delivered ZH->SV task (confirm Yes, audio delivered). */
export async function deliverTask(h: Harness) {
  await toConfirming(h);
  h.send({ type: 'CONFIRM_YES' });
  await h.until('task.result.pending');
  h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
  await h.until('task.result.delivered');
}

export const failing = {
  asr: (category: ConstructorParameters<typeof AppError>[0]): SpeechRecognizer => ({
    transcribe: () => Promise.reject(new AppError(category)),
  }),
};

export type { AudioData };
