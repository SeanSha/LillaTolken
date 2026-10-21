import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transcodeToWav } from '../../apps/server/src/media/transcode';

function ffmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('cloud ASR transcode', () => {
  it.skipIf(!ffmpegAvailable())('decodes a fragmented MP4 to the full utterance, not the first second', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-transcode-'));
    const frag = path.join(dir, 'frag.mp4');
    try {
      execFileSync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
        '-c:a', 'aac', '-b:a', '64k',
        '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        frag,
      ]);
      const wav = await transcodeToWav(
        { bytes: new Uint8Array(fs.readFileSync(frag)), mimeType: 'audio/mp4' },
        { ffmpegBin: 'ffmpeg', tmpRoot: os.tmpdir() },
      );
      expect(wav?.mimeType).toBe('audio/wav');
      expect(wav?.durationMs ?? 0).toBeGreaterThan(2500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
