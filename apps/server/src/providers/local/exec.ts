// Argument-array subprocess runner. NEVER builds shell command strings (no `shell: true`), so
// user-controlled text can never be interpreted by a shell. Injectable for tests.
import { execFile } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

export type RunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Bytes of stdout/stderr kept (default 1 MiB). */
  maxBuffer?: number;
};

export type CommandRunner = (command: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

export class CommandError extends Error {
  constructor(
    readonly kind: 'not_found' | 'timeout' | 'aborted' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * Resolves with the exit code for any process that actually ran (even non-zero).
 * Rejects with CommandError when the binary is missing, timed out or was aborted.
 */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    const child = execFile(
      command,
      [...args],
      { timeout: options.timeoutMs, signal: options.signal, maxBuffer: options.maxBuffer ?? 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr });
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number; name?: string };
        if (e.code === 'ENOENT') return reject(new CommandError('not_found', `${command} not found`));
        if (e.name === 'AbortError') return reject(new CommandError('aborted', 'command aborted'));
        if (e.killed) return reject(new CommandError('timeout', `${command} timed out`));
        if (typeof e.code === 'number') return resolve({ code: e.code, stdout, stderr });
        return reject(new CommandError('failed', `${command} failed`));
      },
    );
    child.stdin?.end();
  });
