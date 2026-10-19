// Provider contracts live in @kt/shared (the browser needs the same types).
// Re-exported here to match the repository layout in docs/SYSTEM_DESIGN.md.
export type {
  AudioData,
  RequestMeta,
  InterpretationResult,
  InterpretInput,
  TranslateInput,
  SpeechRecognizer,
  DialogueModel,
  SpeechSynthesizer,
  ProviderBundle,
} from '@kt/shared';

import type { AiStage, LocalHealthResponse, ProviderBundle } from '@kt/shared';

/** A bundle plus the non-secret metadata the server reports / logs. */
export type RegisteredProvider = {
  bundle: ProviderBundle;
  /** Non-secret identifier of models + prompt version, used in evaluation logs. */
  modelTag: string;
  available: boolean;
  /** Human-readable reason when unavailable (never contains secrets). */
  unavailableReason?: string;
  /** Name used in the price registry / telemetry: 'openai' | 'local' | 'mock'. */
  providerName: string;
  /** Pinned model/engine id per stage (telemetry + price lookup). No secrets. */
  modelFor: (stage: AiStage) => string;
  /** Re-probes an external engine (local only); `available` reflects the latest probe. */
  refresh?: () => Promise<void>;
  /** Detailed engine readiness (local only); consumed by the protected monitor/health routes. */
  localHealth?: (force?: boolean) => Promise<LocalHealthResponse>;
};
