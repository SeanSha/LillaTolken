import { AppError, isErrorCategory, VocabularyIdentifyResponseSchema, type ErrorCategory, type ProviderPreset, type VocabularyIdentifyResponse } from '@kt/shared';

type FetchLike = typeof fetch;

const CLOUD_IDENTIFY_TIMEOUT_MS = 50_000;
/** Longer than the server's Ollama vision timeout so a cold model load returns a server error, not a client abort. */
const LOCAL_IDENTIFY_TIMEOUT_MS = 130_000;

async function errorFromResponse(response: Response): Promise<AppError> {
  let category: ErrorCategory = response.status >= 500 ? 'SERVER' : 'BAD_REQUEST';
  if (response.status === 501) category = 'NOT_CONFIGURED';
  if (response.status === 504) category = 'TIMEOUT';
  try {
    const body = (await response.json()) as { error?: { category?: unknown } };
    if (isErrorCategory(body.error?.category)) category = body.error.category;
  } catch {
    // Keep the status-derived category. The body is never shown.
  }
  return new AppError(category, `HTTP ${response.status}`);
}

/** Sends the already-compressed JPEG. The API key stays on the server. */
export async function identifyImage(
  bytes: Uint8Array,
  mimeType: string,
  options: { fetchImpl?: FetchLike; signal?: AbortSignal; cardId?: string; preset?: ProviderPreset } = {},
): Promise<VocabularyIdentifyResponse> {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<FetchLike>) => fetch(...args));
  const preset = options.preset ?? 'cloud';
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, preset === 'local' ? LOCAL_IDENTIFY_TIMEOUT_MS : CLOUD_IDENTIFY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetchImpl('/api/vocabulary/identify', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Provider-Preset': preset,
        ...(options.cardId && /^[A-Za-z0-9_.:-]{1,80}$/.test(options.cardId) ? { 'X-Card-Id': options.cardId } : {}),
      },
      body: bytes as BodyInit,
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError('INVALID_MODEL_OUTPUT', 'bad vocabulary response');
    }
    const parsed = VocabularyIdentifyResponseSchema.safeParse(payload);
    if (!parsed.success) throw new AppError('INVALID_MODEL_OUTPUT', 'bad vocabulary response');
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (timedOut) throw new AppError('TIMEOUT', 'request timed out');
    if (options.signal?.aborted) throw error;
    throw new AppError('NETWORK', 'network request failed');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
