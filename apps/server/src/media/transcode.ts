// Browser recordings (especially iPhone audio/mp4) often carry a duration index of about one second
// even when the file holds a longer utterance. Decoding to WAV before cloud ASR makes the whole
// recording visible to the transcription model. Temp files are removed before this returns.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudioData } from '@kt/shared';
import { withTempDir } from '../providers/local/common';
import { CommandError, runCommand, type CommandRunner } from '../providers/local/exec';
import { wavDurationMs } from './duration';

export type TranscodeOptions = {
  ffmpegBin: string;
  tmpRoot: string;
  signal?: AbortSignal;
  run?: CommandRunner;
};

function extensionFor(mimeType: string): string {
  if (/mp4|m4a|aac/i.test(mimeType)) return 'm4a';
  if (/webm/i.test(mimeType)) return 'webm';
  if (/ogg|opus/i.test(mimeType)) return 'ogg';
  if (/mpeg|mp3/i.test(mimeType)) return 'mp3';
  if (/flac/i.test(mimeType)) return 'flac';
  return 'bin';
}

/**
 * Returns 16 kHz mono WAV, or undefined when ffmpeg is missing or cannot decode the bytes.
 * Cancellation and timeouts propagate; a bad container falls back to the original upload.
 */
export async function transcodeToWav(audio: AudioData, opts: TranscodeOptions): Promise<AudioData | undefined> {
  if (/wav|wave/i.test(audio.mimeType)) return undefined;
  const run = opts.run ?? runCommand;
  try {
    return await withTempDir(opts.tmpRoot, 'kt-cloud-asr', async (dir) => {
      const input = path.join(dir, `in.${extensionFor(audio.mimeType)}`);
      const output = path.join(dir, 'out.wav');
      await fs.writeFile(input, audio.bytes, { mode: 0o600 });
      const result = await run(
        opts.ffmpegBin,
        ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ignore_editlist', '1', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output],
        { timeoutMs: 30_000, signal: opts.signal },
      );
      if (result.code !== 0) return undefined;
      const bytes = new Uint8Array(await fs.readFile(output));
      const durationMs = wavDurationMs(bytes);
      if (bytes.length <= 44 || durationMs === undefined || durationMs <= 0) return undefined;
      return { bytes, mimeType: 'audio/wav', durationMs };
    });
  } catch (error) {
    if (error instanceof CommandError && (error.kind === 'aborted' || error.kind === 'timeout')) throw error;
    return undefined;
  }
}
