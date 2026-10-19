// Core vocabulary shared by the browser (dialogue manager) and the Node backend.
// Mirrors section 4.4 and 5 of docs/SYSTEM_DESIGN.md.

export type Direction = 'ZH_TO_SV' | 'SV_TO_ZH';
export type InputPurpose = 'INITIAL' | 'CLARIFICATION' | 'CORRECTION';
export type ProviderPreset = 'mock' | 'cloud' | 'local';
export type Language = 'zh' | 'sv';
export type DeliveryMode = 'audio' | 'text_only';

export const PROVIDER_PRESETS: readonly ProviderPreset[] = ['mock', 'cloud', 'local'];

export const LIMITS = {
  segmentSeconds: 30,
  semanticClarifications: 3,
  correctionAttempts: 2,
  asrRetries: 2,
} as const;

/** Hard payload limits enforced by the backend. */
export const PAYLOAD_LIMITS = {
  maxAudioBytes: 10 * 1024 * 1024,
  maxTextChars: 2000,
  maxTextParts: 50,
} as const;

export const APP_VERSION = '0.1.0';

export type DialogueInput = {
  purpose: InputPurpose;
  /** Ordered ASR segments. Volatile: never persisted. */
  textParts: string[];
  /** The clarification question this input answers, if any. */
  inReplyTo?: string;
};

export type LastDelivered = {
  taskId: string;
  direction: Direction;
  /** Confirmed Chinese meaning (ZH->SV) or Swedish ASR text (SV->ZH). */
  source: string;
  translation: string;
};

export function languageOfSpeaker(direction: Direction): Language {
  return direction === 'ZH_TO_SV' ? 'zh' : 'sv';
}

export function targetLanguage(direction: Direction): Language {
  return direction === 'ZH_TO_SV' ? 'sv' : 'zh';
}

export function otherDirection(direction: Direction): Direction {
  return direction === 'ZH_TO_SV' ? 'SV_TO_ZH' : 'ZH_TO_SV';
}
