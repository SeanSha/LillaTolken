// Mac-local provider (docs/SYSTEM_DESIGN.md 5.3): whisper.cpp ASR + Ollama LLM + macOS `say` TTS,
// all behind the SAME three provider contracts as Mock and Cloud. All dialogue policy stays in the
// ONE XState machine. There is deliberately NO fallback to any cloud service: if an engine is
// missing or fails, the call fails with a LOCAL_*_UNAVAILABLE / LOCAL_*_ERROR code.
import {
  AppError,
  type AiStage,
  type AudioData,
  type DialogueModel,
  type InterpretationResult,
  type InterpretInput,
  type Language,
  type LocalHealthResponse,
  type ProviderBundle,
  type RequestMeta,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type TranslateInput,
} from '@kt/shared';
import { PROMPT_VERSION } from '../cloud/prompts';
import { whisperModelName, type LocalConfig } from './config';
import { runCommand, type CommandRunner } from './exec';
import { LocalDialogueModel } from './ollama';
import { overallStatus, probeAsr, probeLlm, probeTts, probeVision, type LocalProbe } from './probe';
import { LocalSpeechSynthesizer } from './tts';
import { LocalSpeechRecognizer } from './whisper';

export { loadLocalConfig, type LocalConfig } from './config';

/** A local adapter is a ProviderBundle plus self-description for /api/health, the monitor and logs. */
export interface LocalProviderAdapter extends ProviderBundle {
  /** Synchronous view of the most recent probe. */
  describe(): { available: boolean; modelTag: string; reason?: string };
  /** Re-probes the engines (cached for `probeTtlMs`). */
  refresh(force?: boolean): Promise<LocalHealthResponse>;
  health(): LocalHealthResponse;
  modelFor(stage: AiStage): string;
}

export type LocalDeps = {
  run?: CommandRunner;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export function localModelTag(cfg: LocalConfig): string {
  return `local:asr=whisper.cpp/${whisperModelName(cfg.whisper.modelFile)};llm=ollama/${cfg.ollama.model};vision=ollama/${cfg.ollama.visionModel};tts=macos_say;prompt=${PROMPT_VERSION}`;
}

const disabledStatus = { ok: false, code: 'LOCAL_DISABLED', detail: 'LOCAL_ENABLED=off' } as const;

/** Bundle for a disabled local preset: every call fails visibly (never falls back to Cloud). */
function disabledBundle(): ProviderBundle {
  const fail = () => Promise.reject(new AppError('NOT_CONFIGURED', 'local preset is disabled (LOCAL_ENABLED=off)', 'LOCAL_DISABLED'));
  return { asr: { transcribe: fail }, dialogue: { interpretChinese: fail, translate: fail }, tts: { synthesize: fail } };
}

export function createLocalProvider(cfg: LocalConfig, deps: LocalDeps = {}): LocalProviderAdapter {
  const run = deps.run ?? runCommand;
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());

  const recognizer = new LocalSpeechRecognizer(cfg, run, fetchImpl);
  const model = new LocalDialogueModel(cfg, fetchImpl);
  const synthesizer = new LocalSpeechSynthesizer(cfg, run, now);

  let probe: LocalProbe | null = null;
  let probedAt = 0;
  let lastError: { code: string; at: string } | null = null;
  let inflight: Promise<LocalHealthResponse> | null = null;

  const toHealth = (): LocalHealthResponse => {
    if (!cfg.enabled) {
      return { checkedAt: new Date(now()).toISOString(), ready: false, status: 'LOCAL_DISABLED', asr: disabledStatus, llm: disabledStatus, vision: disabledStatus, tts: disabledStatus, lastError };
    }
    if (!probe) {
      const pending = { ok: false, code: 'LOCAL_NOT_CHECKED', detail: 'not probed yet' } as const;
      return { checkedAt: new Date(now()).toISOString(), ready: false, status: 'LOCAL_NOT_CHECKED', asr: pending, llm: pending, vision: pending, tts: pending, lastError };
    }
    return { checkedAt: probe.checkedAt, ...overallStatus(probe), asr: probe.asr, llm: probe.llm, vision: probe.vision, tts: probe.tts, lastError };
  };

  /** Records the sanitized code of the last engine failure for the monitor health panel. */
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && code.startsWith('LOCAL_') && !code.endsWith('_CANCELLED')) {
        lastError = { code, at: new Date(now()).toISOString() };
      }
      throw error;
    }
  }

  const asr: SpeechRecognizer = {
    transcribe: (audio: AudioData, language: Language, meta: RequestMeta) => guarded(() => recognizer.transcribe(audio, language, meta)),
  };
  const dialogue: DialogueModel = {
    interpretChinese: (input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> => guarded(() => model.interpretChinese(input, meta)),
    translate: (input: TranslateInput, meta: RequestMeta) => guarded(() => model.translate(input, meta)),
  };
  const tts: SpeechSynthesizer = {
    synthesize: (text: string, language: Language, meta: RequestMeta) => guarded(() => synthesizer.synthesize(text, language, meta)),
  };

  async function refresh(force = false): Promise<LocalHealthResponse> {
    if (!cfg.enabled) return toHealth();
    if (!force && probe && now() - probedAt < cfg.probeTtlMs) return toHealth();
    inflight ??= (async () => {
      try {
        const [a, l, v, t] = await Promise.all([probeAsr(cfg, run, fetchImpl), probeLlm(cfg, fetchImpl), probeVision(cfg, fetchImpl), probeTts(synthesizer)]);
        probe = { checkedAt: new Date(now()).toISOString(), asr: a, llm: l, vision: v, tts: t };
        probedAt = now();
      } finally {
        inflight = null;
      }
      return toHealth();
    })();
    return inflight;
  }

  const base: ProviderBundle = cfg.enabled ? { asr, dialogue, tts } : disabledBundle();
  return {
    ...base,
    describe: () => {
      const h = toHealth();
      const failing = [h.asr, h.llm, h.tts].find((e) => !e.ok);
      return { available: h.ready, modelTag: localModelTag(cfg), reason: h.ready ? undefined : `${h.status}${failing?.detail ? `: ${failing.detail}` : ''}` };
    },
    refresh,
    health: toHealth,
    modelFor: (stage: AiStage) =>
      stage === 'ASR'
        ? `whisper.cpp:${whisperModelName(cfg.whisper.modelFile)}`
        : stage === 'TTS'
          ? 'macos_say'
          : stage === 'IDENTIFY'
            ? `ollama:${cfg.ollama.visionModel}`
            : `ollama:${cfg.ollama.model}`,
  };
}
