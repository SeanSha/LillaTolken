// Local LLM: Ollama /api/chat on 127.0.0.1 (docs/SYSTEM_DESIGN.md 5.3).
// Same prompts, same JSON schema, same validation and same policy cap as the Cloud model.
// This is Ollama LOCAL mode: the model must already be installed (`ollama pull`); a missing model
// is reported as LOCAL_LLM_MODEL_MISSING and is never routed to any cloud.
import {
  AppError,
  type DialogueModel,
  type InterpretationResult,
  type InterpretInput,
  type RequestMeta,
  type TranslateInput,
} from '@kt/shared';
import {
  INTERPRET_JSON_SCHEMA,
  INTERPRET_SYSTEM_PROMPT,
  TRANSLATE_JSON_SCHEMA,
  TRANSLATE_SV_TO_ZH_PROMPT,
  TRANSLATE_ZH_TO_SV_PROMPT,
} from '../cloud/prompts';
import { parseInterpretation, parseJson, parseTranslation } from '../dialogueParsing';
import { mapFetchError, msFromNs, timeoutSignal } from './common';
import type { LocalConfig } from './config';

type OllamaChatResponse = {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number; // ns
  load_duration?: number; // ns
  eval_duration?: number; // ns
  error?: string;
};

export class LocalDialogueModel implements DialogueModel {
  constructor(
    private readonly cfg: LocalConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async chatJson(system: string, user: unknown, schema: object, meta: RequestMeta): Promise<unknown> {
    let data: OllamaChatResponse;
    try {
      const response = await this.fetchImpl(`${this.cfg.ollama.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.ollama.model,
          stream: false,
          think: false, // no verbose internal reasoning (Qwen3 thinking mode off)
          keep_alive: this.cfg.ollama.keepAlive, // keep the model warm between turns
          format: schema, // JSON-schema constrained decoding
          options: { temperature: 0, seed: 0, num_ctx: this.cfg.ollama.numCtx, num_predict: 400 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(user) },
          ],
        }),
        signal: timeoutSignal(meta, this.cfg.ollama.timeoutMs),
      });
      if (response.status === 404) {
        throw new AppError('NOT_CONFIGURED', `Ollama model ${this.cfg.ollama.model} is not installed`, 'LOCAL_LLM_MODEL_MISSING');
      }
      if (!response.ok) throw new AppError('SERVER', `ollama HTTP ${response.status}`, 'LOCAL_LLM_ERROR');
      data = (await response.json()) as OllamaChatResponse;
    } catch (error) {
      throw mapFetchError(error, 'LLM', meta);
    }
    if (data.error) throw new AppError('SERVER', 'ollama reported an error', 'LOCAL_LLM_ERROR');

    // Ollama durations are NANOSECONDS: normalise to milliseconds. total_duration includes the model
    // load, so compute time excludes it and the (cold-start) load time is reported separately.
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

  async interpretChinese(input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> {
    const raw = await this.chatJson(
      INTERPRET_SYSTEM_PROMPT,
      {
        dialogueInputs: input.dialogueInputs,
        remainingClarifications: input.remainingClarifications,
        previousDelivered: input.previousDelivered ?? null,
      },
      INTERPRET_JSON_SCHEMA,
      meta,
    );
    return parseInterpretation(raw, input.remainingClarifications);
  }

  async translate(input: TranslateInput, meta: RequestMeta): Promise<string> {
    const raw = await this.chatJson(
      input.direction === 'ZH_TO_SV' ? TRANSLATE_ZH_TO_SV_PROMPT : TRANSLATE_SV_TO_ZH_PROMPT,
      { text: input.text, previousDelivered: input.previousDelivered ?? null },
      TRANSLATE_JSON_SCHEMA,
      meta,
    );
    return parseTranslation(raw);
  }
}
