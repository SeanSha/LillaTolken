// Local photo vocabulary: Ollama vision model on 127.0.0.1.
// The text model (qwen3) cannot see a picture. This call never falls back to a cloud vision API.
// The image exists only in this request body. It is not written to disk and is never put in an error.
import { AppError, type RequestMeta } from '@kt/shared';
import type { VocabularyImage } from '../../vocabulary/image';
import { VOCABULARY_INSTRUCTIONS, VOCABULARY_RESPONSE_SCHEMA, type VocabularyIdentifier } from '../../vocabulary/identify';
import { normalizeVocabularyModelOutput } from '../../vocabulary/normalize';
import { parseJson } from '../dialogueParsing';
import { mapFetchError, msFromNs, timeoutSignal, unavailable } from './common';
import { isLoopbackUrl, type LocalConfig } from './config';

type OllamaChatResponse = {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  load_duration?: number;
  error?: string;
};

const USER_TEXT = 'Identify the main concrete object in this photo for a vocabulary card.';

export function createLocalVocabularyIdentifier(cfg: LocalConfig, fetchImpl: typeof fetch = (...args) => fetch(...args)): VocabularyIdentifier {
  return {
    async identify(image, signal, report) {
      if (!cfg.enabled) {
        throw new AppError('NOT_CONFIGURED', 'local preset is disabled (LOCAL_ENABLED=off)', 'LOCAL_DISABLED');
      }
      if (!isLoopbackUrl(cfg.ollama.baseUrl)) {
        throw unavailable('LLM', 'OLLAMA_BASE_URL must be a loopback address');
      }
      const meta: RequestMeta = { taskId: 'vocab', requestId: 'vocab', signal, report };
      const raw = await chatVision(cfg, fetchImpl, image, meta);
      return normalizeVocabularyModelOutput(raw);
    },
  };
}

async function chatVision(cfg: LocalConfig, fetchImpl: typeof fetch, image: VocabularyImage, meta: RequestMeta): Promise<unknown> {
  let data: OllamaChatResponse;
  try {
    const response = await fetchImpl(`${cfg.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.ollama.visionModel,
        stream: false,
        think: false,
        keep_alive: cfg.ollama.keepAlive,
        format: VOCABULARY_RESPONSE_SCHEMA,
        // Omit num_ctx. A text-sized window can drop the image tokens before the model sees them.
        options: { temperature: 0, seed: 0, num_predict: 500 },
        messages: [
          { role: 'system', content: VOCABULARY_INSTRUCTIONS },
          { role: 'user', content: USER_TEXT, images: [Buffer.from(image.bytes).toString('base64')] },
        ],
      }),
      signal: timeoutSignal(meta, cfg.ollama.visionTimeoutMs),
    });
    if (response.status === 404) {
      throw new AppError('NOT_CONFIGURED', `Ollama vision model ${cfg.ollama.visionModel} is not installed`, 'LOCAL_LLM_MODEL_MISSING');
    }
    if (!response.ok) throw new AppError('SERVER', `ollama HTTP ${response.status}`, 'LOCAL_LLM_ERROR');
    data = (await response.json()) as OllamaChatResponse;
  } catch (error) {
    throw mapFetchError(error, 'LLM', meta);
  }
  if (data.error) throw new AppError('SERVER', 'ollama reported an error', 'LOCAL_LLM_ERROR');

  const totalMs = msFromNs(data.total_duration);
  const loadMs = msFromNs(data.load_duration);
  meta.report?.({
    promptTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
    engineInferenceMs: totalMs === undefined ? undefined : Math.max(0, totalMs - (loadMs ?? 0)),
    modelLoadMs: loadMs,
  });
  return parseJson(data.message?.content);
}
