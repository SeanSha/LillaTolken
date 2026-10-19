// Shared helpers for the local adapters: request-scoped temp directories and content-free error mapping.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, type RequestMeta } from '@kt/shared';

export type Engine = 'ASR' | 'LLM' | 'TTS';

/**
 * Runs `fn` inside a private (0700) temp directory that is ALWAYS removed afterwards,
 * including on errors and cancellation. Audio/text files exist only for the request's lifetime.
 */
export async function withTempDir<T>(root: string, prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(root, `${prefix}-`));
  await fs.chmod(dir, 0o700).catch(() => undefined);
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function unavailable(engine: Engine, detail: string): AppError {
  return new AppError('NOT_CONFIGURED', detail, `LOCAL_${engine}_UNAVAILABLE`);
}

/** Combines the caller's cancellation signal with a per-call timeout. */
export function timeoutSignal(meta: RequestMeta, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return meta.signal ? AbortSignal.any([meta.signal, timeout]) : timeout;
}

/** Maps a failed fetch() to a content-free AppError with a LOCAL_<ENGINE>_* code. */
export function mapFetchError(error: unknown, engine: Engine, meta: RequestMeta): AppError {
  if (error instanceof AppError) return error;
  if (meta.signal?.aborted) return new AppError('TIMEOUT', 'request aborted', `LOCAL_${engine}_CANCELLED`);
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError') return new AppError('TIMEOUT', `local ${engine} timed out`, `LOCAL_${engine}_TIMEOUT`);
  if (name === 'AbortError') return new AppError('TIMEOUT', 'request aborted', `LOCAL_${engine}_CANCELLED`);
  // undici reports "fetch failed" (ECONNREFUSED/ECONNRESET/...) as a TypeError.
  return new AppError('NETWORK', `local ${engine} engine unreachable`, `LOCAL_${engine}_UNAVAILABLE`);
}

export const msFromNs = (ns: unknown): number | undefined =>
  typeof ns === 'number' && Number.isFinite(ns) && ns >= 0 ? ns / 1_000_000 : undefined;
