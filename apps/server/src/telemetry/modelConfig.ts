// Stable, secret-free description of the models a preset will actually call.
// The id is a hash of that description, so the same configuration always maps to the same row.
import { createHash } from 'node:crypto';
import type { AiStage, ModelConfig, ProviderPreset } from '@kt/shared';
import type { ServerConfig } from '../config';
import { PROMPT_VERSION } from '../providers/cloud/prompts';
import { whisperModelName } from '../providers/local/config';

export type ModelConfigSnapshot = Omit<ModelConfig, 'modelConfigId' | 'createdAt'>;

type Params = ModelConfigSnapshot['params'];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    .join(',')}}`;
}

/** First 20 hex chars of SHA-256. Inputs must already exclude secrets. */
export function stableModelConfigId(snapshot: ModelConfigSnapshot): string {
  return `mc_${createHash('sha256').update(canonicalJson(snapshot)).digest('hex').slice(0, 20)}`;
}

/**
 * Resolved runtime configuration for one preset.
 * Uses the registry's modelFor (the id the adapter will send), plus non-secret parameters.
 * API keys, passwords and filesystem paths that can contain a home directory are omitted.
 */
export function snapshotForPreset(preset: ProviderPreset, config: ServerConfig, modelFor: (stage: AiStage) => string): ModelConfigSnapshot {
  if (preset === 'cloud') {
    const openai = config.openai;
    return {
      preset,
      asrProvider: 'openai',
      asrModel: modelFor('ASR'),
      interpretProvider: 'openai',
      interpretModel: modelFor('INTERPRET'),
      translateProvider: 'openai',
      translateModel: modelFor('TRANSLATE'),
      ttsProvider: 'openai',
      ttsModel: modelFor('TTS'),
      ttsVoice: openai.ttsVoice,
      params: {
        promptVersion: PROMPT_VERSION,
        temperature: openai.temperature ?? null,
      },
    };
  }
  if (preset === 'local') {
    const local = config.local;
    const params: Params = {
      promptVersion: PROMPT_VERSION,
      whisperModel: whisperModelName(local.whisper.modelFile),
      ollamaModel: local.ollama.model,
      ollamaNumCtx: local.ollama.numCtx,
      ollamaKeepAlive: local.ollama.keepAlive,
      temperature: 0,
    };
    return {
      preset,
      asrProvider: 'whisper.cpp',
      asrModel: modelFor('ASR'),
      interpretProvider: 'ollama',
      interpretModel: modelFor('INTERPRET'),
      translateProvider: 'ollama',
      translateModel: modelFor('TRANSLATE'),
      ttsProvider: 'macos_say',
      ttsModel: modelFor('TTS'),
      ttsVoice: `zh=${local.tts.voiceZh ?? 'auto'};sv=${local.tts.voiceSv ?? 'auto'}`,
      params,
    };
  }
  return {
    preset,
    asrProvider: 'mock',
    asrModel: modelFor('ASR'),
    interpretProvider: 'mock',
    interpretModel: modelFor('INTERPRET'),
    translateProvider: 'mock',
    translateModel: modelFor('TRANSLATE'),
    ttsProvider: 'mock',
    ttsModel: modelFor('TTS'),
    ttsVoice: null,
    params: { promptVersion: PROMPT_VERSION },
  };
}
