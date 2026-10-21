// OpenAI Cloud provider (docs/SYSTEM_DESIGN.md 5.2): ASR + structured LLM + TTS.
// Credentials stay server-side. Adult voices and non-identifying/synthetic input only.
// Nothing here writes audio, transcripts or prompts to disk or to logs.
import OpenAI, { toFile } from 'openai';
import {
  AppError,
  type AudioData,
  type DialogueModel,
  type InterpretationResult,
  type InterpretInput,
  type Language,
  type ProviderBundle,
  type RequestMeta,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type TranslateInput,
} from '@kt/shared';
import type { ServerConfig } from '../../config';
import { mp3DurationMs } from '../../media/duration';
import { transcodeToWav, type TranscodeOptions } from '../../media/transcode';
import { CommandError } from '../local/exec';
import { parseInterpretation, parseJson, parseTranslation } from '../dialogueParsing';
import {
  INTERPRET_JSON_SCHEMA,
  INTERPRET_SYSTEM_PROMPT,
  PROMPT_VERSION,
  TRANSLATE_JSON_SCHEMA,
  TRANSLATE_SV_TO_ZH_PROMPT,
  TRANSLATE_ZH_TO_SV_PROMPT,
  TTS_INSTRUCTIONS,
} from './prompts';

type OpenAIConfig = ServerConfig['openai'];

export function cloudModelTag(cfg: OpenAIConfig): string {
  return `openai:asr=${cfg.asrModel};llm=${cfg.llmModel};tts=${cfg.ttsModel}/${cfg.ttsVoice};prompt=${PROMPT_VERSION}`;
}

/** Map any SDK/network failure to a content-free AppError. */
export function mapOpenAIError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIUserAbortError) return new AppError('TIMEOUT', 'request aborted');
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AppError('TIMEOUT', 'upstream timeout');
  if (error instanceof OpenAI.APIConnectionError) return new AppError('NETWORK', 'upstream connection error');
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return new AppError('NOT_CONFIGURED', 'OpenAI credentials rejected');
    if (error.status === 429) return new AppError('SERVER', 'OpenAI rate limit or quota (HTTP 429)');
    if (error.status === 400 || error.status === 404) {
      // Typically a wrong/unavailable model id or unsupported parameter. Message is vendor text, no user content.
      return new AppError('SERVER', `OpenAI request rejected (HTTP ${error.status})`);
    }
    return new AppError('SERVER', `OpenAI error (HTTP ${error.status ?? 'unknown'})`);
  }
  return new AppError('SERVER', 'unexpected upstream error');
}

const EXTENSIONS: Array<[RegExp, string]> = [
  [/mp4|m4a|aac/i, 'm4a'],
  [/webm/i, 'webm'],
  [/ogg|opus/i, 'ogg'],
  [/wav|wave/i, 'wav'],
  [/mpeg|mp3/i, 'mp3'],
  [/flac/i, 'flac'],
];

export function extensionForMime(mimeType: string): string {
  return EXTENSIONS.find(([re]) => re.test(mimeType))?.[1] ?? 'webm';
}

const memoryNote = (prev: InterpretInput['previousDelivered']) => (prev ? prev : null);

/** GPT-6 defaults to a reasoning effort other than `none`, which rejects `temperature`. */
export function dialogueTemperature(model: string, temperature: number | undefined): { temperature?: number } {
  if (temperature === undefined || model.startsWith('gpt-6')) return {};
  return { temperature };
}

/**
 * `gpt-transcribe` takes `languages` and rejects the older singular `language` field.
 * Mandarin is hinted as `cmn`: `zh` comes back in Traditional characters.
 */
export function asrLanguageBody(model: string, language: Language): { language: Language } | { languages: string[] } {
  if (model === 'gpt-transcribe' || model.startsWith('gpt-transcribe-')) {
    return { languages: [language === 'zh' ? 'cmn' : language] };
  }
  return { language };
}

export class OpenAISpeechRecognizer implements SpeechRecognizer {
  constructor(
    private readonly client: OpenAI,
    private readonly cfg: OpenAIConfig,
    private readonly prep?: Pick<TranscodeOptions, 'ffmpegBin' | 'tmpRoot'>,
  ) {}

  async transcribe(audio: AudioData, language: Language, meta: RequestMeta): Promise<string> {
    const payload = await this.audioForUpload(audio, meta);
    try {
      const file = await toFile(payload.bytes, `segment.${extensionForMime(payload.mimeType)}`, {
        type: payload.mimeType.split(';')[0] || 'audio/webm',
      });
      const result = await this.client.audio.transcriptions.create(
        {
          file,
          model: this.cfg.asrModel,
          response_format: 'json',
          ...asrLanguageBody(this.cfg.asrModel, language),
        } as OpenAI.Audio.TranscriptionCreateParamsNonStreaming,
        { signal: meta.signal, timeout: this.cfg.timeoutMs },
      );
      // Metadata only: usage numbers, never the text.
      const usage = (result as { usage?: { type?: string; input_tokens?: number; output_tokens?: number; seconds?: number } }).usage;
      const reported: { promptTokens?: number; outputTokens?: number; inputAudioMs?: number; resolvedModel: string } = { resolvedModel: this.cfg.asrModel };
      if (usage?.type === 'tokens') {
        reported.promptTokens = usage.input_tokens;
        reported.outputTokens = usage.output_tokens;
      } else if (usage?.type === 'duration' && usage.seconds !== undefined) reported.inputAudioMs = Math.round(usage.seconds * 1000);
      meta.report?.(reported);
      return (result.text ?? '').trim();
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  /** Decode phone containers to WAV so a one-second MP4 index cannot hide the rest of the utterance. */
  private async audioForUpload(audio: AudioData, meta: RequestMeta): Promise<AudioData> {
    if (!this.prep) return audio;
    try {
      return (await transcodeToWav(audio, { ...this.prep, signal: meta.signal })) ?? audio;
    } catch (error) {
      if (error instanceof CommandError) {
        if (error.kind === 'timeout') throw new AppError('TIMEOUT', 'audio conversion timed out');
        throw new AppError('TIMEOUT', 'request aborted');
      }
      throw error;
    }
  }
}

export class OpenAIDialogueModel implements DialogueModel {
  constructor(
    private readonly client: OpenAI,
    private readonly cfg: OpenAIConfig,
  ) {}

  private async completeJson(
    system: string,
    user: unknown,
    schemaName: string,
    schema: object,
    meta: RequestMeta,
  ): Promise<unknown> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.cfg.llmModel,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(user) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema: schema as Record<string, unknown> },
          },
          ...dialogueTemperature(this.cfg.llmModel, this.cfg.temperature),
        },
        { signal: meta.signal, timeout: this.cfg.timeoutMs },
      );
      meta.report?.({
        promptTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
        cachedPromptTokens: completion.usage?.prompt_tokens_details?.cached_tokens,
        resolvedModel: completion.model || this.cfg.llmModel,
      });
      return parseJson(completion.choices[0]?.message?.content);
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  async interpretChinese(input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> {
    const raw = await this.completeJson(
      INTERPRET_SYSTEM_PROMPT,
      {
        dialogueInputs: input.dialogueInputs,
        remainingClarifications: input.remainingClarifications,
        previousDelivered: memoryNote(input.previousDelivered),
      },
      'interpretation',
      INTERPRET_JSON_SCHEMA,
      meta,
    );
    return parseInterpretation(raw, input.remainingClarifications);
  }

  async translate(input: TranslateInput, meta: RequestMeta): Promise<string> {
    const raw = await this.completeJson(
      input.direction === 'ZH_TO_SV' ? TRANSLATE_ZH_TO_SV_PROMPT : TRANSLATE_SV_TO_ZH_PROMPT,
      { text: input.text, previousDelivered: memoryNote(input.previousDelivered) },
      'translation',
      TRANSLATE_JSON_SCHEMA,
      meta,
    );
    return parseTranslation(raw);
  }
}

export class OpenAISpeechSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly client: OpenAI,
    private readonly cfg: OpenAIConfig,
  ) {}

  async synthesize(text: string, language: Language, meta: RequestMeta): Promise<AudioData> {
    try {
      const supportsInstructions = this.cfg.ttsModel.startsWith('gpt-4o');
      const response = await this.client.audio.speech.create(
        {
          model: this.cfg.ttsModel,
          voice: this.cfg.ttsVoice as 'alloy',
          input: text,
          response_format: 'mp3', // plays on iOS Safari
          ...(supportsInstructions ? { instructions: TTS_INSTRUCTIONS[language] } : {}),
        },
        { signal: meta.signal, timeout: this.cfg.timeoutMs },
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) throw new AppError('TTS', 'empty audio from TTS');
      const durationMs = mp3DurationMs(bytes);
      meta.report?.({ outputAudioMs: durationMs, resolvedModel: this.cfg.ttsModel, resolvedVoice: this.cfg.ttsVoice });
      return { bytes, mimeType: 'audio/mpeg', durationMs };
    } catch (error) {
      const mapped = mapOpenAIError(error);
      throw mapped.category === 'SERVER' ? new AppError('TTS', mapped.message) : mapped;
    }
  }
}

/** Bundle whose every call fails with NOT_CONFIGURED (used when no API key is present). */
export function createUnconfiguredCloudProvider(): ProviderBundle {
  const fail = () => Promise.reject(new AppError('NOT_CONFIGURED', 'OPENAI_API_KEY is not set on the server'));
  return {
    asr: { transcribe: fail },
    dialogue: { interpretChinese: fail, translate: fail },
    tts: { synthesize: fail },
  };
}

export function createCloudProvider(cfg: OpenAIConfig, prep?: Pick<TranscodeOptions, 'ffmpegBin' | 'tmpRoot'>): ProviderBundle {
  if (!cfg.apiKey) return createUnconfiguredCloudProvider();
  const client = new OpenAI({ apiKey: cfg.apiKey, maxRetries: cfg.maxRetries, timeout: cfg.timeoutMs });
  return {
    asr: new OpenAISpeechRecognizer(client, cfg, prep),
    dialogue: new OpenAIDialogueModel(client, cfg),
    tts: new OpenAISpeechSynthesizer(client, cfg),
  };
}
