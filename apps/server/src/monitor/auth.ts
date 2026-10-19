// Minimal admin authentication for /monitor and every other metadata/diagnostic route.
//  - No hardcoded or shared default password. Source, in order:
//      1. MONITOR_ADMIN_PASSWORD (env, read by Node only, never bundled into the frontend)
//      2. a random password generated ONCE and stored in apps/server/data/monitor-admin-password (mode 0600)
//  - Login exchanges the password for a random opaque token in an HttpOnly, SameSite=Strict cookie.
//    Only a SHA-256 hash of the token is kept server-side. The password is never put in a URL.
//  - Failed logins are throttled per client.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';

export const COOKIE_NAME = 'kt_monitor';
export const MIN_PASSWORD_LENGTH = 8;

export type AdminPassword = { password: string; source: 'env' | 'file' | 'generated'; file?: string };

/** Resolves the admin password without ever returning a built-in default. */
export function resolveAdminPassword(opts: { envPassword?: string; file: string; warn?: (m: string) => void }): AdminPassword {
  if (opts.envPassword) {
    if (opts.envPassword.length >= MIN_PASSWORD_LENGTH) return { password: opts.envPassword, source: 'env' };
    opts.warn?.(`MONITOR_ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters and was ignored`);
  }
  try {
    const existing = fs.readFileSync(opts.file, 'utf8').trim();
    if (existing.length >= MIN_PASSWORD_LENGTH) return { password: existing, source: 'file', file: opts.file };
  } catch {
    // generate below
  }
  const password = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  fs.writeFileSync(opts.file, `${password}\n`, { mode: 0o600 });
  return { password, source: 'generated', file: opts.file };
}

const sha256 = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();

export class MonitorAuth {
  private readonly passwordHash: Buffer;
  private readonly sessions = new Map<string, number>(); // sha256(token) hex -> expiry (ms)
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    password: string,
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.passwordHash = sha256(password);
  }

  /** Constant-time comparison of password hashes. */
  verifyPassword(candidate: string): boolean {
    return crypto.timingSafeEqual(this.passwordHash, sha256(candidate));
  }

  /** Returns seconds to wait if this client is locked out, else 0. */
  lockedFor(client: string): number {
    const f = this.failures.get(client);
    if (!f || f.lockedUntil <= this.now()) return 0;
    return Math.ceil((f.lockedUntil - this.now()) / 1000);
  }

  recordFailure(client: string): void {
    const f = this.failures.get(client) ?? { count: 0, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= 5) {
      f.lockedUntil = this.now() + 60_000;
      f.count = 0;
    }
    this.failures.set(client, f);
  }

  recordSuccess(client: string): void {
    this.failures.delete(client);
  }

  createSession(): { token: string; maxAgeSec: number } {
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sha256(token).toString('hex'), this.now() + this.ttlMs);
    return { token, maxAgeSec: Math.floor(this.ttlMs / 1000) };
  }

  isValid(token: string | undefined): boolean {
    if (!token) return false;
    const key = sha256(token).toString('hex');
    const expiry = this.sessions.get(key);
    if (expiry === undefined) return false;
    if (expiry <= this.now()) {
      this.sessions.delete(key);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(sha256(token).toString('hex'));
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Client address behind the ONE trusted hop (the Vite dev/preview proxy, `xfwd: true`).
 * That proxy APPENDS the socket address it saw to any X-Forwarded-For the client sent, so only the
 * LAST entry is trustworthy; earlier entries are client-controlled and must never be used (otherwise
 * a LAN device could send `X-Forwarded-For: 127.0.0.1` to bypass MONITOR_LOCAL_ONLY or reset the
 * login throttle).
 */
export function clientAddress(req: Request): string {
  const forwarded = req.header('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).at(-1);
  return forwarded || req.socket.remoteAddress || 'unknown';
}

export function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address === 'localhost';
}

/** Mutating requests must come from our own origin (defence in depth next to SameSite=Strict). */
export function sameOrigin(req: Request): boolean {
  const origin = req.header('origin');
  if (!origin) return true; // non-browser client (curl/tests); cookies still required
  try {
    return new URL(origin).host === req.header('host');
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function clearedCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
