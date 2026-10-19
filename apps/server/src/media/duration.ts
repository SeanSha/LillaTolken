// Media duration of generated/converted audio (NOT processing time). Used only for monitoring:
// `ttsGeneratedAudioMs` and `inputAudioMs`. Pure functions on bytes; nothing is written anywhere.

/** Duration of a PCM WAV file in ms, or undefined if it is not a parseable WAV. */
export function wavDurationMs(bytes: Uint8Array): number | undefined {
  if (bytes.length < 44) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return undefined;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 8 + 12 <= bytes.length) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === 'data') {
      if (byteRate <= 0) return undefined;
      // Streamed WAVs may carry 0 / 0xFFFFFFFF as the size: trust the real buffer length then.
      const available = bytes.length - (offset + 8);
      const dataBytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      return Math.round((dataBytes / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Duration of an MPEG Layer III (mp3) stream by walking its frame headers. */
export function mp3DurationMs(bytes: Uint8Array): number | undefined {
  let pos = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    pos = 10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f));
  }
  let seconds = 0;
  let frames = 0;
  while (pos + 4 <= bytes.length) {
    const b1 = bytes[pos + 1]!;
    if (bytes[pos] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      pos += 1; // resync
      continue;
    }
    const version = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b1 >> 1) & 3; // 1 = Layer III
    const b2 = bytes[pos + 2]!;
    const bitrateIndex = b2 >> 4;
    const rateIndex = (b2 >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      pos += 1;
      continue;
    }
    const bitrate = (version === 3 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex]! * 1000;
    const sampleRate = SAMPLE_RATES[version]![rateIndex]!;
    const padding = (b2 >> 1) & 1;
    const samplesPerFrame = version === 3 ? 1152 : 576;
    const frameLength = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
    if (frameLength < 4) {
      pos += 1;
      continue;
    }
    seconds += samplesPerFrame / sampleRate;
    frames += 1;
    pos += frameLength;
  }
  return frames > 0 ? Math.round(seconds * 1000) : undefined;
}

export function audioDurationMs(bytes: Uint8Array, mimeType: string): number | undefined {
  if (/wav|wave/i.test(mimeType)) return wavDurationMs(bytes);
  if (/mpeg|mp3/i.test(mimeType)) return mp3DurationMs(bytes);
  return undefined;
}
