// Provider contracts (docs/SYSTEM_DESIGN.md section 5).
// ASR, LLM and TTS are three independent interfaces so hybrid setups stay possible.
import type { Direction, DialogueInput, Language, LastDelivered } from './types';

export type AudioData = {
  bytes: Uint8Array;
  mimeType: string;
  durationMs?: number;
  /**
   * MOCK PRESET ONLY. Scripted transcript carried alongside (possibly fake) audio so the
   * deterministic Mock ASR can "recognise" it. Real providers ignore this field.
   */
  mockTranscript?: string;
};

/**
 * Metadata-only usage/timing numbers an adapter can report for ONE invocation
 * (docs/SYSTEM_DESIGN.md 6.2 / 6.4). Never put content here.
 * Durations are milliseconds (Ollama's nanoseconds are converted by the adapter).
 */
export type NormalizedUsage = {
  promptTokens?: number;
  outputTokens?: number;
  cachedPromptTokens?: number;
  /** ASR/TTS audio durations (media time, NOT processing time). */
  inputAudioMs?: number;
  outputAudioMs?: number;
  /** Model-side duration reported by the engine (do not substitute for the wall-clock timer). */
  engineInferenceMs?: number;
  /** ffmpeg / input-conversion component of a local ASR request. */
  conversionMs?: number;
  /** Model load / cold start (Ollama `load_duration`). */
  modelLoadMs?: number;
};

export type RequestMeta = {
  taskId: string;
  requestId: string;
  signal?: AbortSignal;
  /**
   * Optional telemetry context, filled in by the Node backend only (never by the machine).
   * Adapters may call `report` once per invocation; it is a no-op when absent.
   */
  sessionId?: string;
  direction?: Direction;
  /** Set by the vocabulary client. Absent on the translator, which stays `translate`. */
  feature?: 'translate' | 'vocabulary';
  cardId?: string;
  report?: (usage: NormalizedUsage) => void;
};

export type InterpretationResult =
  | { kind: 'ASK_CLARIFICATION'; questionZh: string; reasonCode: string }
  | { kind: 'PROPOSE_MEANING'; meaningZh: string }
  | { kind: 'UNRESOLVED'; reasonCode: string };

export interface SpeechRecognizer {
  transcribe(audio: AudioData, language: Language, meta: RequestMeta): Promise<string>;
}

export type InterpretInput = {
  dialogueInputs: DialogueInput[];
  remainingClarifications: number;
  previousDelivered?: LastDelivered | null;
};

export type TranslateInput = {
  text: string;
  direction: Direction;
  previousDelivered?: LastDelivered | null;
};

export interface DialogueModel {
  interpretChinese(input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult>;
  translate(input: TranslateInput, meta: RequestMeta): Promise<string>;
}

export interface SpeechSynthesizer {
  synthesize(text: string, language: Language, meta: RequestMeta): Promise<AudioData>;
}

export type ProviderBundle = {
  asr: SpeechRecognizer;
  dialogue: DialogueModel;
  tts: SpeechSynthesizer;
};
