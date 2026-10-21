// Composition root for the browser: wires the ONE dialogue machine to real I/O.
import { AppError, MockScript, type ProviderBundle, type ProviderPreset } from '@kt/shared';
import { AudioPlayer } from '../audio/player';
import { SpeechPrompts } from '../audio/prompts';
import { AudioStore } from '../audio/audioStore';
import { MediaRecorderRecorder, ScriptedRecorder } from '../audio/recorder';
import { createDialogueMachine } from '../dialogue/machine';
import type { Recorder } from '../dialogue/types';
import { createApiBundle, fetchHealth, type Health, type RequestContext } from './apiClient';
import { EventLogger } from './eventLogger';
import { captureTestCodeFromUrl, getTestCode } from './testSession';
import { settings } from './settings';

export const audioStore = new AudioStore();
export const player = new AudioPlayer();
export const prompts = new SpeechPrompts();
export const mockScript = new MockScript(settings.get().mockScenarioId);

let health: Health | null = null;
export const getHealth = () => health;

export async function refreshHealth(): Promise<Health | null> {
  try {
    health = await fetchHealth();
  } catch {
    health = null;
  }
  return health;
}

/** Preset of the current/most recent task (the recorder needs to know whether audio is real). */
let activePreset: ProviderPreset = 'mock';
export const setActivePreset = (preset: ProviderPreset) => {
  activePreset = preset;
};

// Fetch preset availability + non-secret model tags as early as possible (used in evaluation logs).
if (typeof window !== 'undefined') {
  captureTestCodeFromUrl();
  void refreshHealth();
}

// Non-content telemetry context for backend requests: which session/direction the CURRENT task
// belongs to. Learned from the machine's own TASK_STARTED event; applied only to that task id.
const taskContext = new Map<string, RequestContext>();

export const logger = new EventLogger({
  onLog: (fields) => {
    if (fields.eventType === 'TASK_STARTED' && fields.taskId) {
      taskContext.clear(); // only the current task matters
      taskContext.set(fields.taskId, { sessionId: fields.sessionId, direction: fields.direction, testCode: getTestCode() });
    }
  },
  getScenarioId: () => settings.get().scenarioId.trim() || (activePreset === 'mock' ? mockScript.scenarioId : undefined),
  getModelTag: (preset) => health?.presets[preset]?.modelTag,
  getTestCode,
});

const bundles = new Map<ProviderPreset, ProviderBundle>();
const providers = (preset: ProviderPreset): ProviderBundle => {
  let bundle = bundles.get(preset);
  if (!bundle) {
    bundle = createApiBundle(preset, { getContext: (taskId) => taskContext.get(taskId) });
    bundles.set(preset, bundle);
  }
  return bundle;
};

/**
 * Chooses the microphone implementation when a segment starts. Cloud/local presets always use
 * the real microphone. For `mock`, `auto` means a simulated (scripted) microphone; a tester can
 * force the real microphone to exercise permission/MIME/segment handling on a phone while the
 * deterministic Mock ASR still returns the scripted text.
 */
class RecorderFacade implements Recorder {
  private current: Recorder | null = null;
  private real: MediaRecorderRecorder | null = null;

  private choose(): Recorder {
    const { micMode } = settings.get();
    if (activePreset !== 'mock') {
      this.real ??= new MediaRecorderRecorder();
      return this.real;
    }
    if (micMode === 'real') {
      this.real ??= new MediaRecorderRecorder();
      return new ScriptedRecorder(mockScript, this.real);
    }
    return new ScriptedRecorder(mockScript);
  }

  /** Warm up the real microphone (only when one will actually be used) while a prompt plays. */
  async prepare(): Promise<void> {
    const { micMode } = settings.get();
    if (activePreset === 'mock' && micMode !== 'real') return;
    this.real ??= new MediaRecorderRecorder();
    await this.real.prepare();
  }

  async start(): Promise<void> {
    this.current?.cancel();
    this.current = this.choose();
    await this.current.start();
  }

  async stop() {
    if (!this.current) throw new AppError('RECORDER', 'not recording');
    const current = this.current;
    this.current = null;
    return current.stop();
  }

  cancel(): void {
    this.current?.cancel();
    this.current = null;
    this.real?.cancel();
  }
}

export const recorder = new RecorderFacade();

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);

export const dialogueMachine = createDialogueMachine({
  providers,
  recorder,
  audioStore,
  speakPrompt: (id, language, hooks) => prompts.speak(id, language, hooks),
  stopSpeaking: () => prompts.stop(),
  stopPlayback: () => player.stop(),
  log: (fields) => logger.log(fields),
  lastPlaybackMs: () => player.lastPlaybackMs(),
  newId: randomId,
  now: () => Date.now(),
  onTaskStarted: ({ preset }) => {
    setActivePreset(preset);
    mockScript.reset(); // every new task replays the selected scenario from its first utterance
  },
});
