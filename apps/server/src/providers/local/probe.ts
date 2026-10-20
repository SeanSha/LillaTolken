// Readiness probes for the three local engines. Content-free and side-effect free:
// no audio, no text, no billable calls, nothing leaves the loopback interface.
import fs from 'node:fs/promises';
import type { EngineStatus } from '@kt/shared';
import { CommandError, type CommandRunner } from './exec';
import { isLoopbackUrl, whisperModelName, type LocalConfig } from './config';
import type { LocalSpeechSynthesizer } from './tts';

export type LocalProbe = { checkedAt: string; asr: EngineStatus; llm: EngineStatus; vision: EngineStatus; tts: EngineStatus };

const PROBE_TIMEOUT_MS = 1500;

async function fetchBrief(fetchImpl: typeof fetch, url: string): Promise<Response | 'busy' | null> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch (error) {
    // A timeout means the engine accepted the connection but is busy inferring: not "down".
    if ((error as { name?: string } | null)?.name === 'TimeoutError') return 'busy';
    return null; // connection refused / reset: definitively not running
  }
}

export function ollamaHasModel(models: readonly string[], wanted: string): boolean {
  const norm = (n: string) => (n.includes(':') ? n : `${n}:latest`);
  return models.some((m) => norm(m) === norm(wanted));
}

export async function probeAsr(cfg: LocalConfig, run: CommandRunner, fetchImpl: typeof fetch): Promise<EngineStatus> {
  const modelTag = `whisper.cpp:${whisperModelName(cfg.whisper.modelFile)}`;
  if (!isLoopbackUrl(cfg.whisper.baseUrl)) {
    return { ok: false, code: 'LOCAL_ASR_UNAVAILABLE', detail: 'WHISPER_BASE_URL must be a loopback address', modelTag };
  }
  try {
    await run(cfg.ffmpegBin, ['-version'], { timeoutMs: 5000 });
  } catch (error) {
    const missing = error instanceof CommandError && error.kind === 'not_found';
    return { ok: false, code: 'LOCAL_ASR_UNAVAILABLE', detail: missing ? 'ffmpeg is not installed (brew install ffmpeg)' : 'ffmpeg check failed', modelTag };
  }
  const res = await fetchBrief(fetchImpl, `${cfg.whisper.baseUrl}/`);
  if (res === null) {
    return { ok: false, code: 'LOCAL_ASR_UNAVAILABLE', detail: 'whisper.cpp server is not running (npm run local:start)', modelTag };
  }
  return { ok: true, modelTag, detail: res === 'busy' ? 'busy (inference in progress)' : undefined };
}

async function probeOllamaModel(cfg: LocalConfig, fetchImpl: typeof fetch, model: string): Promise<EngineStatus> {
  const modelTag = `ollama:${model}`;
  if (!isLoopbackUrl(cfg.ollama.baseUrl)) {
    return { ok: false, code: 'LOCAL_LLM_UNAVAILABLE', detail: 'OLLAMA_BASE_URL must be a loopback address', modelTag };
  }
  const res = await fetchBrief(fetchImpl, `${cfg.ollama.baseUrl}/api/tags`);
  if (res === null) return { ok: false, code: 'LOCAL_LLM_UNAVAILABLE', detail: 'Ollama is not running (open the Ollama app or run `ollama serve`)', modelTag };
  if (res === 'busy') return { ok: true, modelTag, detail: 'busy' };
  if (!res.ok) return { ok: false, code: 'LOCAL_LLM_UNAVAILABLE', detail: `Ollama answered HTTP ${res.status}`, modelTag };
  try {
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    if (!ollamaHasModel(names, model)) {
      return { ok: false, code: 'LOCAL_LLM_MODEL_MISSING', detail: `model not installed: run \`ollama pull ${model}\``, modelTag };
    }
    return { ok: true, modelTag };
  } catch {
    return { ok: false, code: 'LOCAL_LLM_UNAVAILABLE', detail: 'unexpected response from Ollama', modelTag };
  }
}

/** Text model used by interpretation and translation. */
export function probeLlm(cfg: LocalConfig, fetchImpl: typeof fetch): Promise<EngineStatus> {
  return probeOllamaModel(cfg, fetchImpl, cfg.ollama.model);
}

/**
 * Vision model used only by photo vocabulary.
 * A missing vision model does not make the translator preset unready: qwen3 text and this model are independent.
 */
export function probeVision(cfg: LocalConfig, fetchImpl: typeof fetch): Promise<EngineStatus> {
  return probeOllamaModel(cfg, fetchImpl, cfg.ollama.visionModel);
}

export async function probeTts(tts: LocalSpeechSynthesizer): Promise<EngineStatus> {
  try {
    const [zh, sv] = await Promise.allSettled([tts.voiceFor('zh'), tts.voiceFor('sv')]);
    const tag = `macos_say:zh=${zh.status === 'fulfilled' ? zh.value.name : '-'};sv=${sv.status === 'fulfilled' ? sv.value.name : '-'}`;
    const missing = [zh.status === 'rejected' ? 'Mandarin (zh_*)' : null, sv.status === 'rejected' ? 'Swedish (sv_SE)' : null].filter(Boolean);
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'LOCAL_TTS_UNAVAILABLE',
        detail: `no installed macOS voice for: ${missing.join(', ')} (System Settings > Accessibility > Spoken Content > System Voice > Manage Voices)`,
        modelTag: tag,
      };
    }
    return { ok: true, modelTag: tag };
  } catch {
    return { ok: false, code: 'LOCAL_TTS_UNAVAILABLE', detail: 'macOS say is not available', modelTag: 'macos_say' };
  }
}

export async function modelFileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** First failing engine decides the overall status, e.g. LOCAL_TTS_UNAVAILABLE. */
export function overallStatus(p: Pick<LocalProbe, 'asr' | 'llm' | 'tts'>): { ready: boolean; status: string } {
  for (const e of [p.asr, p.llm, p.tts]) if (!e.ok) return { ready: false, status: e.code ?? 'LOCAL_UNAVAILABLE' };
  return { ready: true, status: 'LOCAL_READY' };
}
