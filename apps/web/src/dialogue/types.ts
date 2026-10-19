import type {
  AudioData,
  DeliveryMode,
  Direction,
  DialogueInput,
  ErrorCategory,
  EvalEventType,
  EvalStage,
  InputPurpose,
  LastDelivered,
  Language,
  ProviderBundle,
  ProviderPreset,
} from '@kt/shared';

export type { DialogueInput, LastDelivered, InputPurpose, Direction, ProviderPreset };

export type SegmentInfo = { id: string; durationMs: number; purpose: InputPurpose };

export type Task = {
  id: string;
  direction: Direction;
  /** Frozen for the lifetime of the task. */
  preset: ProviderPreset;
  inputPurpose: InputPurpose;
  segmentInfo: SegmentInfo[];
  /** Segments recorded for the CURRENT input and not yet transcribed (audio lives in the AudioStore). */
  pendingSegments: number;
  dialogueInputs: DialogueInput[];
  proposedMeaning: string | null;
  currentQuestion: string | null;
  confirmedMeaning: string | null;
  /** Swedish ASR text for SV->ZH tasks (shown to the adult tester). */
  sourceText: string | null;
  translatedText: string | null;
  clarificationCount: number;
  correctionCount: number;
  asrRetryCount: number;
  startedAt: number;
};

/** Where SWITCH_NO returns to (a safe checkpoint, see docs section 4.3). */
export type SafeReturnKey =
  | 'recording'
  | 'segmentDecision'
  | 'transcribing'
  | 'asrEmpty'
  | 'interpreting'
  | 'clarifying'
  | 'confirming'
  | 'translating'
  | 'result'
  | 'recoverableError'
  | 'fallback';

export type FallbackReason =
  | 'CLARIFICATION_LIMIT'
  | 'UNRESOLVED'
  | 'CORRECTION_LIMIT'
  | 'ASR_EMPTY_LIMIT';

export type ErrorStage = EvalStage | 'recorder';

export type MachineContext = {
  sessionId: string;
  /** Developer-selected preset. Changeable only while idle; copied into Task.preset on start. */
  preset: ProviderPreset;
  task: Task | null;
  lastDelivered: LastDelivered | null;
  pendingDirection: Direction | null;
  safeReturnState: SafeReturnKey | null;
  activeRequestId: string | null;
  error: { stage: ErrorStage; category: ErrorCategory } | null;
  fallbackReason: FallbackReason | null;
  /** Status of the app-spoken audio for the current screen (prompt or result). */
  audioStatus: 'none' | 'ready' | 'failed';
  segmentStartedAt: number | null;
};

export type DialogueEvent =
  | { type: 'START_TASK'; direction: Direction }
  | { type: 'SET_PRESET'; preset: ProviderPreset }
  | { type: 'SKIP_PROMPT' }
  | { type: 'STOP_SEGMENT' }
  | { type: 'SEGMENT_TIMEOUT' }
  | { type: 'CONTINUE_SPEAKING' }
  | { type: 'FINISH_INPUT' }
  | { type: 'START_ANSWER' }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_NO' }
  | { type: 'SWITCH_REQUESTED'; direction: Direction }
  | { type: 'SWITCH_YES' }
  | { type: 'SWITCH_NO' }
  | { type: 'DELIVERY_FINISHED'; mode: DeliveryMode }
  | { type: 'RETRY' }
  | { type: 'CANCEL' }
  | { type: 'RESTART' }
  | { type: 'NEW_TURN' }
  | { type: 'END_SESSION' };

export type PromptId = 'start' | 'continue' | 'switch' | 'asrEmpty' | 'fallback' | 'error';

/** Which volatile slot an app-spoken clip occupies. */
export type PlaybackSlot = 'prompt' | 'result';

/** Volatile audio store: audio never enters XState snapshots and is never persisted. */
export interface AudioStoreLike {
  addSegment(taskId: string, audio: AudioData): void;
  getSegments(taskId: string): AudioData[];
  clearSegments(taskId: string): void;
  setPlayback(slot: PlaybackSlot, audio: AudioData): void;
  getPlayback(slot: PlaybackSlot): AudioData | null;
  clearPlayback(slot: PlaybackSlot): void;
  clearAll(): void;
}

export interface Recorder {
  /**
   * Optional warm-up: open the microphone WITHOUT capturing, so a later start() is instant.
   * Called while a spoken prompt plays. Never throws; start() reports real errors.
   */
  prepare?(): Promise<void>;
  /** Resolves once audio is actually being captured. Rejects with AppError(PERMISSION_DENIED|RECORDER). */
  start(): Promise<void>;
  /** Stops capture and returns the segment. */
  stop(): Promise<AudioData>;
  /** Discards any live/pending capture. Idempotent. */
  cancel(): void;
}

export type LogFields = {
  taskId?: string;
  direction?: Direction;
  providerPreset: ProviderPreset;
  eventType: EvalEventType;
  elapsedMs?: number;
  segmentDurationMs?: number;
  clarificationCount?: number;
  stage?: EvalStage;
  stageDurationMs?: number;
  errorCategory?: ErrorCategory;
  deliveryMode?: DeliveryMode;
  sessionId: string;
  segmentId?: string;
  inputPurpose?: InputPurpose;
  segmentIndex?: number;
  playbackMs?: number;
};

export type DialogueDeps = {
  /** Returns the provider bundle for a (frozen) preset. */
  providers: (preset: ProviderPreset) => ProviderBundle;
  recorder: Recorder;
  audioStore: AudioStoreLike;
  /**
   * Speak a short static prompt (pre-generated audio). Must resolve (never hang) so recording can proceed.
   * `onNearEnd` fires once just before the prompt ends (or when it ends/cannot play), never if cancelled.
   */
  speakPrompt: (id: PromptId, language: Language, hooks?: { onNearEnd?: () => void }) => Promise<void>;
  stopSpeaking: () => void;
  /** Stop any playing clip (prompt/result audio). */
  stopPlayback: () => void;
  log: (fields: LogFields) => void;
  /** Duration of the most recent completed result playback on this device (monitoring only). */
  lastPlaybackMs?: () => number | undefined;
  newId: () => string;
  now: () => number;
  /** Called when a new task starts (e.g. to reset the mock script). */
  onTaskStarted?: (task: { id: string; direction: Direction; preset: ProviderPreset }) => void;
};
