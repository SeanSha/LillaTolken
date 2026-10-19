/** Deterministic, tiny 16-bit mono PCM WAV tone. Playable in every browser, no assets needed. */
export function makeToneWav(opts: { frequencyHz: number; durationMs: number; sampleRate?: number }): Uint8Array {
  const sampleRate = opts.sampleRate ?? 16000;
  const samples = Math.max(1, Math.floor((sampleRate * opts.durationMs) / 1000));
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);
  const fade = Math.min(Math.floor(sampleRate * 0.03), Math.floor(samples / 2));
  for (let i = 0; i < samples; i += 1) {
    let envelope = 1;
    if (i < fade) envelope = i / fade;
    else if (i > samples - fade) envelope = (samples - i) / fade;
    const value = Math.sin((2 * Math.PI * opts.frequencyHz * i) / sampleRate) * 0.25 * envelope;
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return new Uint8Array(buffer);
}
