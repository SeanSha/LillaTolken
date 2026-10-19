// Local ASR: whisper.cpp HTTP server on 127.0.0.1 (docs/SYSTEM_DESIGN.md 5.3).
//  1. The browser blob (iPhone Safari: AAC in MP4/M4A; Chromium: WebM/Opus) is converted LOCALLY by
//     ffmpeg to 16 kHz mono PCM WAV in a request-scoped temp dir that is always deleted.
//  2. POST /inference (multipart) with an explicit language. ASR never translates.
//  3. One transcript per call == per segment; the machine keeps segment order and boundaries.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, type AudioData, type Language, type RequestMeta, type SpeechRecognizer } from '@kt/shared';
import { wavDurationMs } from '../../media/duration';
import { extensionForMime } from '../cloud';
import { CommandError, type CommandRunner } from './exec';
import { mapFetchError, timeoutSignal, unavailable, withTempDir } from './common';
import type { LocalConfig } from './config';

/** Biases Whisper to emit Simplified Chinese (without it the output is often Traditional). */
const ZH_PROMPT = '以下是普通话的句子。';

/** Strips non-speech markers Whisper emits for silence ("[BLANK_AUDIO]", "(music)"); nothing else is "repaired". */
export function cleanWhisperText(raw: string, language: Language): string {
  const withoutMarkers = raw.replace(/\[[^\]]{0,40}\]|\((?:music|musik|silence|tystnad|applause)[^)]{0,20}\)/gi, ' ');
  const lines = withoutMarkers
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.join(language === 'zh' ? '' : ' ').trim();
}

export async function convertToWav(
  audio: AudioData,
  cfg: Pick<LocalConfig, 'ffmpegBin' | 'tmpRoot'>,
  run: CommandRunner,
  meta: RequestMeta,
): Promise<{ wav: Uint8Array; conversionMs: number; durationMs: number | undefined }> {
  const started = performance.now();
  return withTempDir(cfg.tmpRoot, 'kt-asr', async (dir) => {
    const input = path.join(dir, `in.${extensionForMime(audio.mimeType)}`);
    const output = path.join(dir, 'out.wav');
    await fs.writeFile(input, audio.bytes, { mode: 0o600 });
    try {
      const result = await run(
        cfg.ffmpegBin,
        ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output],
        { timeoutMs: 30_000, signal: meta.signal },
      );
      if (result.code !== 0) throw new AppError('BAD_REQUEST', 'audio could not be decoded', 'LOCAL_ASR_BAD_AUDIO');
    } catch (error) {
      if (error instanceof CommandError) {
        if (error.kind === 'not_found') throw unavailable('ASR', 'ffmpeg is not installed');
        if (error.kind === 'timeout') throw new AppError('TIMEOUT', 'audio conversion timed out', 'LOCAL_ASR_TIMEOUT');
        throw new AppError('TIMEOUT', 'request aborted', 'LOCAL_ASR_CANCELLED');
      }
      throw error;
    }
    const wav = new Uint8Array(await fs.readFile(output));
    return { wav, conversionMs: performance.now() - started, durationMs: wavDurationMs(wav) };
  });
}

export class LocalSpeechRecognizer implements SpeechRecognizer {
  constructor(
    private readonly cfg: LocalConfig,
    private readonly run: CommandRunner,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async transcribe(audio: AudioData, language: Language, meta: RequestMeta): Promise<string> {
    const { wav, conversionMs, durationMs } = await convertToWav(audio, this.cfg, this.run, meta);

    const form = new FormData();
    form.set('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'segment.wav');
    form.set('language', language); // explicit: no auto-detect, no translate-to-English
    form.set('response_format', 'json');
    form.set('temperature', '0');
    if (language === 'zh') form.set('prompt', ZH_PROMPT);

    const started = performance.now();
    let body: unknown;
    try {
      const response = await this.fetchImpl(`${this.cfg.whisper.baseUrl}/inference`, {
        method: 'POST',
        body: form,
        signal: timeoutSignal(meta, this.cfg.whisper.timeoutMs),
      });
      if (!response.ok) throw new AppError('SERVER', `whisper HTTP ${response.status}`, 'LOCAL_ASR_ERROR');
      body = await response.json();
    } catch (error) {
      throw mapFetchError(error, 'ASR', meta);
    }
    const text = (body as { text?: unknown; error?: unknown } | null)?.text;
    if (typeof text !== 'string') throw new AppError('SERVER', 'whisper returned no text field', 'LOCAL_ASR_ERROR');

    meta.report?.({
      conversionMs,
      engineInferenceMs: performance.now() - started, // measured HTTP sub-step: whisper.cpp reports no timing
      inputAudioMs: durationMs ?? audio.durationMs,
    });
    return cleanWhisperText(text, language);
  }
}
