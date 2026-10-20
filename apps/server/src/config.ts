import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadLocalConfig, type LocalConfig } from './providers/local/config';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');

export const serverRoot = path.join(repoRoot, 'apps/server');

/** `:memory:` stays as-is; relative paths are resolved against apps/server. */
function resolveServerPath(value: string | undefined, fallback: string): string {
  const v = value || fallback;
  if (v === ':memory:') return v;
  return path.isAbsolute(v) ? v : path.join(serverRoot, v);
}

export type ServerConfig = {
  port: number;
  host: string;
  openai: {
    apiKey: string | undefined;
    asrModel: string;
    llmModel: string;
    /** Vision-capable model used only by photo vocabulary identification. */
    visionModel: string;
    ttsModel: string;
    ttsVoice: string;
    /** undefined -> do not send the parameter */
    temperature: number | undefined;
    timeoutMs: number;
    maxRetries: number;
  };
  promptMemory: boolean;
  persistEvents: boolean;
  eventsFile: string;
  local: LocalConfig;
  vocabulary: {
    /** Card words and paths. Photos and audio are files, not rows in this database. */
    dbPath: string;
    mediaDir: string;
  };
  monitor: {
    /** SQLite metadata database (apps/server/data/telemetry.sqlite by default). */
    dbPath: string;
    /** From MONITOR_ADMIN_PASSWORD only; otherwise a random one is generated once (see monitor/auth). */
    adminPassword: string | undefined;
    passwordFile: string;
    /** MONITOR_LOCAL_ONLY=on rejects monitor requests that did not originate on this Mac. */
    localOnly: boolean;
    pricesFile: string;
    sessionTtlMs: number;
  };
};

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return !['off', 'false', '0', 'no'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const tempRaw = env.OPENAI_LLM_TEMPERATURE;
  return {
    port: num(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    openai: {
      apiKey: env.OPENAI_API_KEY?.trim() || undefined,
      asrModel: env.OPENAI_ASR_MODEL || 'gpt-4o-transcribe',
      llmModel: env.OPENAI_LLM_MODEL || 'gpt-4.1-mini',
      visionModel: env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
      ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      ttsVoice: env.OPENAI_TTS_VOICE || 'alloy',
      temperature: tempRaw === undefined ? 0 : tempRaw === '' ? undefined : num(tempRaw, 0),
      timeoutMs: num(env.OPENAI_TIMEOUT_MS, 30000),
      maxRetries: num(env.OPENAI_MAX_RETRIES, 1),
    },
    promptMemory: flag(env.PROMPT_MEMORY, true),
    persistEvents: flag(env.PERSIST_EVENTS, true),
    eventsFile: path.join(repoRoot, 'apps/server/data/events.ndjson'),
    local: loadLocalConfig(env, repoRoot),
    vocabulary: {
      dbPath: resolveServerPath(env.VOCABULARY_DB_PATH, 'data/vocabulary.sqlite'),
      mediaDir: resolveServerPath(env.VOCABULARY_MEDIA_DIR, 'data/vocabulary-media'),
    },
    monitor: {
      dbPath: resolveServerPath(env.MONITOR_DB_PATH, 'data/telemetry.sqlite'),
      adminPassword: env.MONITOR_ADMIN_PASSWORD || undefined,
      passwordFile: path.join(serverRoot, 'data/monitor-admin-password'),
      localOnly: flag(env.MONITOR_LOCAL_ONLY, false),
      pricesFile: resolveServerPath(env.PRICES_FILE, 'config/prices.json'),
      sessionTtlMs: num(env.MONITOR_SESSION_HOURS, 12) * 3_600_000,
    },
  };
}

/** Load `.env` from the repo root (backend only; the browser never sees it). */
export function loadDotenv(): void {
  dotenv.config({ path: path.join(repoRoot, '.env') });
}
