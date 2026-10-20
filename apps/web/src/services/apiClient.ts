// Typed backend client. Implements the SAME three provider contracts as the server, so the
// dialogue machine does not know (or care) which preset sits behind the HTTP calls.
// No API key or private endpoint ever exists in the browser.
import {
  AppError,
  AsrResponseSchema,
  InterpretationResultSchema,
  TranslateResponseSchema,
  isErrorCategory,
  type AudioData,
  type Direction,
  type DialogueModel,
  type ErrorCategory,
  type InterpretationResult,
  type InterpretInput,
  type Language,
  type ProviderBundle,
  type ProviderPreset,
  type RequestMeta,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type TranslateInput,
} from '@kt/shared';

const DEFAULT_TIMEOUT_MS = 45_000;

type FetchLike = typeof fetch;

export type RequestContext = { sessionId?: string; direction?: Direction };

export type ApiClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Non-content telemetry context for a task (session id, direction). Optional. */
  getContext?: (taskId: string) => RequestContext | undefined;
};

function headersFor(
  preset: ProviderPreset,
  meta: RequestMeta,
  extra: Record<string, string> = {},
  context?: RequestContext,
): Record<string, string> {
  return {
    'X-Provider-Preset': preset,
    'X-Task-Id': meta.taskId,
    'X-Request-Id': meta.requestId,
    ...(context?.sessionId ? { 'X-Session-Id': context.sessionId } : {}),
    ...(context?.direction ? { 'X-Direction': context.direction } : {}),
    ...(meta.feature ? { 'X-Feature': meta.feature } : {}),
    ...(meta.cardId ? { 'X-Card-Id': meta.cardId } : {}),
    ...extra,
  };
}

async function readError(response: Response): Promise<AppError> {
  let category: ErrorCategory = response.status >= 500 ? 'SERVER' : 'BAD_REQUEST';
  try {
    const body = (await response.json()) as { error?: { category?: unknown } };
    if (isErrorCategory(body.error?.category)) category = body.error.category;
  } catch {
    // keep the status-derived category
  }
  return new AppError(category, `HTTP ${response.status}`);
}

class HttpTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl ?? '';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** Aborts on caller cancellation (task switched/cancelled) or on timeout. */
  async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!response.ok) throw await readError(response);
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (timedOut) throw new AppError('TIMEOUT', 'request timed out');
      if (signal?.aborted) throw error; // intentional cancellation: let the caller ignore it
      throw new AppError('NETWORK', 'network request failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export function createApiBundle(preset: ProviderPreset, options: ApiClientOptions = {}): ProviderBundle {
  const http = new HttpTransport(options);
  const headers = (meta: RequestMeta, extra: Record<string, string> = {}) =>
    headersFor(preset, meta, extra, options.getContext?.(meta.taskId));
  const jsonInit = (meta: RequestMeta, body: unknown): RequestInit => ({
    method: 'POST',
    headers: headers(meta, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const asr: SpeechRecognizer = {
    async transcribe(audio: AudioData, language: Language, meta: RequestMeta): Promise<string> {
      const extra: Record<string, string> = {
        'Content-Type': audio.mimeType || 'application/octet-stream',
      };
      if (audio.durationMs !== undefined) extra['X-Duration-Ms'] = String(Math.round(audio.durationMs));
      // Mock preset only: scripted transcript (header-safe encoding).
      if (preset === 'mock' && audio.mockTranscript !== undefined) {
        extra['X-Mock-Transcript'] = encodeURIComponent(audio.mockTranscript);
      }
      const response = await http.request(
        `/api/asr?language=${language}`,
        { method: 'POST', headers: headers(meta, extra), body: audio.bytes as BodyInit },
        meta.signal,
      );
      const parsed = AsrResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad ASR response');
      return parsed.data.text;
    },
  };

  const dialogue: DialogueModel = {
    async interpretChinese(input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> {
      const response = await http.request('/api/interpret', jsonInit(meta, input), meta.signal);
      const parsed = InterpretationResultSchema.safeParse(await response.json());
      if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad interpretation response');
      return parsed.data;
    },
    async translate(input: TranslateInput, meta: RequestMeta): Promise<string> {
      const response = await http.request('/api/translate', jsonInit(meta, input), meta.signal);
      const parsed = TranslateResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad translation response');
      return parsed.data.translation;
    },
  };

  const tts: SpeechSynthesizer = {
    async synthesize(text: string, language: Language, meta: RequestMeta): Promise<AudioData> {
      const response = await http.request('/api/tts', jsonInit(meta, { text, language }), meta.signal);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) throw new AppError('TTS', 'empty audio');
      return { bytes, mimeType: response.headers.get('content-type') ?? 'audio/mpeg' };
    },
  };

  return { asr, dialogue, tts };
}

// ---------- health ----------
export type PresetHealth = { available: boolean; modelTag: string; reason?: string };
export type Health = { ok: boolean; version: string; promptMemory: boolean; presets: Record<ProviderPreset, PresetHealth> };

export async function fetchHealth(options: ApiClientOptions = {}): Promise<Health> {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<FetchLike>) => fetch(...args));
  const response = await fetchImpl(`${options.baseUrl ?? ''}/api/health`);
  if (!response.ok) throw new AppError('SERVER', `health HTTP ${response.status}`);
  return (await response.json()) as Health;
}
