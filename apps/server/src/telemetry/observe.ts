// The ONE server-side telemetry wrapper (docs/SYSTEM_DESIGN.md 6.4).
// Every provider path (mock / cloud / local) goes through it, so exactly ONE row is written per
// real backend model invocation - including failures, cancellations and retries.
// It never stores prompts, transcripts, translations, audio or raw error bodies, and a telemetry
// failure can never replace or swallow the original result/error.
import {
  AppError,
  errorCodeOf,
  type AiStage,
  type AudioData,
  type Direction,
  type DialogueModel,
  type InterpretationResult,
  type InterpretInput,
  type Language,
  type NormalizedUsage,
  type ProviderBundle,
  type ProviderPreset,
  type RequestMeta,
  type RequestStatus,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type TranslateInput,
} from '@kt/shared';
import type { TelemetryDb } from './db';
import type { PriceRegistry } from './pricing';

export type ObserveOptions = {
  db: TelemetryDb | null;
  prices: PriceRegistry;
  preset: ProviderPreset;
  /** 'openai' | 'local' | 'mock' - matches `provider` in the price registry. */
  providerName: string;
  /** Pinned model/engine id for each stage (no secrets). */
  modelFor: (stage: AiStage) => string;
  /** Called after a row was written (e.g. soft budget alert). Must not throw. */
  onRecorded?: (info: { preset: ProviderPreset; costUsd: number | null }) => void;
  now?: () => number; // monotonic ms (tests)
  clock?: () => Date;
};

function classify(error: unknown, meta: RequestMeta): RequestStatus {
  if (meta.signal?.aborted) return 'cancelled';
  if (error instanceof AppError && error.category === 'TIMEOUT') return 'timeout';
  return 'failed';
}

const finite = (n: number | undefined): number | undefined => (n !== undefined && Number.isFinite(n) ? n : undefined);

/** Direction can be missing from headers: infer it from what the stage itself implies. */
export function inferDirection(stage: AiStage, meta: RequestMeta, hint?: { language?: Language; direction?: Direction }): Direction | null {
  if (meta.direction) return meta.direction;
  if (hint?.direction) return hint.direction;
  if (stage === 'INTERPRET') return 'ZH_TO_SV';
  if (stage === 'ASR' && hint?.language) return hint.language === 'zh' ? 'ZH_TO_SV' : 'SV_TO_ZH';
  return null; // TTS: Chinese could be a prompt (ZH->SV) or the result (SV->ZH)
}

export function observeBundle(bundle: ProviderBundle, o: ObserveOptions): ProviderBundle {
  const mono = o.now ?? (() => performance.now());
  const clock = o.clock ?? (() => new Date());

  async function observe<T>(
    stage: AiStage,
    meta: RequestMeta,
    hint: { language?: Language; direction?: Direction; inputAudioMs?: number },
    invoke: (meta: RequestMeta) => Promise<T>,
    afterSuccess?: (value: T, usage: NormalizedUsage) => void,
  ): Promise<T> {
    const usage: NormalizedUsage = {};
    if (finite(hint.inputAudioMs) !== undefined) usage.inputAudioMs = hint.inputAudioMs;
    const startedAt = clock().toISOString();
    const t0 = mono();
    let status: RequestStatus = 'succeeded';
    let errorCode: string | null = null;
    const wrapped: RequestMeta = { ...meta, report: (u) => Object.assign(usage, u) };
    try {
      const value = await invoke(wrapped);
      afterSuccess?.(value, usage);
      return value;
    } catch (error) {
      status = classify(error, meta);
      errorCode = errorCodeOf(error);
      throw error;
    } finally {
      // Telemetry must never disturb the request: swallow its own failures, keep the original outcome.
      try {
        const durationMs = Math.max(0, mono() - t0);
        const model = o.modelFor(stage);
        const cost = o.prices.calculate({
          preset: o.preset,
          providerName: o.providerName,
          model,
          stage,
          usage,
          priceable: status === 'succeeded',
        });
        if (o.db) {
          const sessionId = meta.sessionId ?? `unknown-${meta.taskId}`;
          o.db.recordRequest({
            requestId: meta.requestId,
            taskId: meta.taskId,
            sessionId,
            segmentId: null,
            startedAt,
            endedAt: clock().toISOString(),
            preset: o.preset,
            stage,
            direction: inferDirection(stage, meta, hint),
            providerName: o.providerName,
            modelTag: model,
            durationMs,
            engineInferenceMs: usage.engineInferenceMs ?? null,
            conversionMs: usage.conversionMs ?? null,
            modelLoadMs: usage.modelLoadMs ?? null,
            inputAudioMs: usage.inputAudioMs ?? null,
            outputAudioMs: usage.outputAudioMs ?? null,
            promptTokens: usage.promptTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            cachedPromptTokens: usage.cachedPromptTokens ?? null,
            status,
            errorCode,
            costUsd: cost.costUsd,
            costBasis: cost.costBasis,
            priceRevision: cost.priceRevision,
            costDetail: cost.detail,
          });
        }
        o.onRecorded?.({ preset: o.preset, costUsd: cost.costUsd });
      } catch {
        // intentionally ignored
      }
    }
  }

  const asr: SpeechRecognizer = {
    transcribe: (audio: AudioData, language: Language, meta: RequestMeta) =>
      observe('ASR', meta, { language, inputAudioMs: audio.durationMs }, (m) => bundle.asr.transcribe(audio, language, m)),
  };

  const dialogue: DialogueModel = {
    interpretChinese: (input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> =>
      observe('INTERPRET', meta, { direction: 'ZH_TO_SV' }, (m) => bundle.dialogue.interpretChinese(input, m)),
    translate: (input: TranslateInput, meta: RequestMeta): Promise<string> =>
      observe('TRANSLATE', meta, { direction: input.direction }, (m) => bundle.dialogue.translate(input, m)),
  };

  const tts: SpeechSynthesizer = {
    synthesize: (text: string, language: Language, meta: RequestMeta) =>
      observe(
        'TTS',
        meta,
        { language },
        (m) => bundle.tts.synthesize(text, language, m),
        (audio, usage) => {
          if (usage.outputAudioMs === undefined && audio.durationMs !== undefined) usage.outputAudioMs = audio.durationMs;
        },
      ),
  };

  return { asr, dialogue, tts };
}
