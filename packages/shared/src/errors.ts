export type ErrorCategory =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SERVER'
  | 'INVALID_MODEL_OUTPUT'
  | 'ASR_EMPTY'
  | 'PERMISSION_DENIED'
  | 'RECORDER'
  | 'TTS'
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'
  | 'UNKNOWN';

const CATEGORIES: readonly ErrorCategory[] = [
  'NETWORK',
  'TIMEOUT',
  'SERVER',
  'INVALID_MODEL_OUTPUT',
  'ASR_EMPTY',
  'PERMISSION_DENIED',
  'RECORDER',
  'TTS',
  'NOT_CONFIGURED',
  'BAD_REQUEST',
  'UNKNOWN',
];

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Error with a coarse category. Messages must NEVER contain audio, transcripts,
 * translations or prompts: they may end up in logs.
 */
export class AppError extends Error {
  readonly category: ErrorCategory;
  /** Optional sanitized machine code, e.g. LOCAL_TTS_UNAVAILABLE (never contains content). */
  readonly code?: string;
  constructor(category: ErrorCategory, message?: string, code?: string) {
    super(message ?? category);
    this.name = 'AppError';
    this.category = category;
    if (code) this.code = code;
  }
}

/** Sanitized, content-free code for telemetry: explicit code if present, else the category. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof AppError) return error.code ?? error.category;
  return toAppError(error, 'UNKNOWN').category;
}

export function toAppError(error: unknown, fallback: ErrorCategory = 'UNKNOWN'): AppError {
  if (error instanceof AppError) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    isErrorCategory((error as { category: unknown }).category)
  ) {
    return new AppError((error as { category: ErrorCategory }).category);
  }
  return new AppError(fallback);
}

export function httpStatusFor(category: ErrorCategory): number {
  switch (category) {
    case 'BAD_REQUEST':
      return 400;
    case 'NOT_CONFIGURED':
      return 501;
    case 'TIMEOUT':
      return 504;
    case 'INVALID_MODEL_OUTPUT':
    case 'NETWORK':
    case 'SERVER':
      return 502;
    case 'ASR_EMPTY':
      return 422;
    default:
      return 500;
  }
}
