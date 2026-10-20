// Configuration of the Mac-local provider (docs/SYSTEM_DESIGN.md 5.3).
// Every engine is addressed on the loopback interface ONLY: local inference must never contact a
// model vendor, and the engines' native ports must never be reachable from the LAN.
import os from 'node:os';
import path from 'node:path';

export type LocalConfig = {
  /** LOCAL_ENABLED=off hides the preset (used by tests / machines without local AI). */
  enabled: boolean;
  ollama: {
    baseUrl: string;
    /** Text model for interpretation and translation. It cannot see a photo. */
    model: string;
    /** Vision model for photo vocabulary. Separate from `model`; never a cloud fallback. */
    visionModel: string;
    keepAlive: string;
    timeoutMs: number;
    /** Photo identification is slower than a text turn, especially on a cold load. */
    visionTimeoutMs: number;
    numCtx: number;
  };
  whisper: {
    baseUrl: string;
    /** Model FILE the whisper-server was started with (used for the model tag + `local:start`). */
    modelFile: string;
    timeoutMs: number;
    binary: string;
  };
  ffmpegBin: string;
  tts: {
    engine: 'macos_say';
    sayBin: string;
    /** Blank = auto-detect an installed zh_* / sv_* voice at runtime (never hardcoded). */
    voiceZh: string | undefined;
    voiceSv: string | undefined;
    timeoutMs: number;
  };
  tmpRoot: string;
  /** How long a readiness probe result is reused (ms). */
  probeTtlMs: number;
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function num(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return !['off', 'false', '0', 'no'].includes(value.toLowerCase());
}

export function loadLocalConfig(env: NodeJS.ProcessEnv, repoRoot: string): LocalConfig {
  const modelFile = env.WHISPER_MODEL || 'models/whisper/ggml-small.bin';
  return {
    enabled: flag(env.LOCAL_ENABLED, true),
    ollama: {
      baseUrl: (env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
      model: env.OLLAMA_MODEL || 'qwen3:8b',
      visionModel: env.OLLAMA_VISION_MODEL || 'qwen3-vl:8b',
      keepAlive: env.OLLAMA_KEEP_ALIVE || '30m',
      timeoutMs: num(env.OLLAMA_TIMEOUT_MS, 90_000),
      visionTimeoutMs: num(env.OLLAMA_VISION_TIMEOUT_MS, 120_000),
      numCtx: num(env.OLLAMA_NUM_CTX, 4096),
    },
    whisper: {
      baseUrl: (env.WHISPER_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
      modelFile: path.isAbsolute(modelFile) ? modelFile : path.join(repoRoot, modelFile),
      timeoutMs: num(env.WHISPER_TIMEOUT_MS, 60_000),
      binary: env.WHISPER_BIN || 'whisper-server',
    },
    ffmpegBin: env.FFMPEG_BIN || 'ffmpeg',
    tts: {
      engine: 'macos_say',
      sayBin: env.SAY_BIN || 'say',
      voiceZh: env.LOCAL_TTS_VOICE_ZH?.trim() || undefined,
      voiceSv: env.LOCAL_TTS_VOICE_SV?.trim() || undefined,
      timeoutMs: num(env.LOCAL_TTS_TIMEOUT_MS, 30_000),
    },
    tmpRoot: env.LOCAL_TMP_DIR || os.tmpdir(),
    probeTtlMs: num(env.LOCAL_PROBE_TTL_MS, 2_000),
  };
}

/** e.g. models/whisper/ggml-large-v3-turbo-q5_0.bin -> large-v3-turbo-q5_0 */
export function whisperModelName(modelFile: string): string {
  return path.basename(modelFile).replace(/^ggml-/, '').replace(/\.bin$/, '');
}
