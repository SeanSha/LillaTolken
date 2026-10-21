import { describe, expect, it } from 'vitest';
import { wavDurationMs } from '../../apps/server/src/media/duration';
import { CAPTURE_SAMPLE_RATE, encodePcmWav, resampleMono } from '../../apps/web/src/audio/recorder';

describe('PCM capture encoding', () => {
  it('writes one second of 16 kHz audio as a WAV the server can time', () => {
    const wav = encodePcmWav(new Float32Array(CAPTURE_SAMPLE_RATE), CAPTURE_SAMPLE_RATE);
    expect(wavDurationMs(wav)).toBe(1000);
  });

  it('averages a 48 kHz block down to 16 kHz instead of keeping only the first sample', () => {
    const input = new Float32Array(48);
    for (let i = 0; i < input.length; i++) input[i] = i;
    const out = resampleMono(input, 48_000, 16_000);
    expect(out.length).toBe(16);
    expect(out[0]).toBeCloseTo((0 + 1 + 2) / 3);
  });
});
