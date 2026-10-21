import { AppError, type AudioData } from '@kt/shared';
import type { Recorder } from '../dialogue/types';
import { setAudioSession } from './session';

/**
 * Safari (esp. iPhone) records MP4/AAC; Chrome/Firefox record WebM/Opus. Never assume WebM:
 * pick the first type this browser reports as supported.
 */
export const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** PCM rate uploaded for cloud ASR. 16 kHz mono keeps a 30 s segment well under the body limit. */
export const CAPTURE_SAMPLE_RATE = 16_000;

/** Average blocks of `fromRate` samples down to `toRate`. Used because iOS ignores a requested AudioContext rate. */
export function resampleMono(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const outLength = Math.max(1, Math.floor((samples.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ?? 0;
    out[i] = sum / (end - start);
  }
  return out;
}

/** 16-bit mono PCM WAV. Header matches what `wavDurationMs` on the server reads. */
export function encodePcmWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function isMicrophoneSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export type MicEnvironment = { supported: boolean; secureContext: boolean; mimeType: string | undefined };

export function inspectMicEnvironment(): MicEnvironment {
  return {
    supported: isMicrophoneSupported(),
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    mimeType: pickRecorderMimeType(),
  };
}

/**
 * One AudioContext for the whole page. Creating a new one for every sentence fails on iOS after the
 * first take: the new context stays silent until the previous one is reclaimed, which is the
 * "wait a moment and it works again" delay.
 */
let sharedContext: AudioContext | undefined;

function sharedAudioContext(): AudioContext | undefined {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof Ctx.prototype.createScriptProcessor !== 'function') return undefined;
  if (!sharedContext || sharedContext.state === 'closed') {
    try {
      sharedContext = new Ctx();
    } catch {
      return undefined;
    }
  }
  return sharedContext;
}

/**
 * Captures the microphone as PCM instead of Safari's audio/mp4.
 * That container often indexes only the first second, so a long utterance is transcribed as silence
 * and a shorter one as a fragment with the wrong meaning.
 */
class PcmCapture {
  private closed = false;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly processor: ScriptProcessorNode,
    private readonly mute: GainNode,
    private readonly chunks: Float32Array[],
  ) {}

  static async tryStart(stream: MediaStream): Promise<PcmCapture | undefined> {
    const ctx = sharedAudioContext();
    if (!ctx) return undefined;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      return undefined;
    }
    if (ctx.state !== 'running') return undefined;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    // A silent sink is required or Safari never delivers onaudioprocess. Gain 0 keeps it inaudible.
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    const capture = new PcmCapture(ctx, source, processor, mute, chunks);
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (chunks.length === 0 || ctx.state !== 'running') {
      capture.detach();
      return undefined;
    }
    return capture;
  }

  finish(wallDurationMs: number): AudioData {
    this.detach();
    const merged = mergeChunks(this.chunks);
    const samples = resampleMono(merged, this.ctx.sampleRate || CAPTURE_SAMPLE_RATE, CAPTURE_SAMPLE_RATE);
    const bytes = encodePcmWav(samples, CAPTURE_SAMPLE_RATE);
    const sampleMs = Math.round((samples.length / CAPTURE_SAMPLE_RATE) * 1000);
    return { bytes, mimeType: 'audio/wav', durationMs: sampleMs > 0 ? sampleMs : wallDurationMs };
  }

  /** Drops this take's nodes. The shared AudioContext stays open for the next sentence. */
  detach(): void {
    if (this.closed) return;
    this.closed = true;
    this.processor.onaudioprocess = null;
    try {
      this.source.disconnect();
      this.processor.disconnect();
      this.mute.disconnect();
    } catch {
      // already disconnected
    }
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Real microphone recorder. Prefers PCM WAV; falls back to one MediaRecorder blob. Audio stays in memory. */
export class MediaRecorderRecorder implements Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private pcm: PcmCapture | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  /** Bumped by cancel() so a getUserMedia that resolves late is released instead of used. */
  private generation = 0;

  /** A microphone stream that is open (or opening) but not yet recording (see prepare()). */
  private ready: Promise<MediaStream> | null = null;

  private async openStream(): Promise<MediaStream> {
    if (!isMicrophoneSupported()) throw new AppError('RECORDER', 'MediaRecorder / getUserMedia not supported');
    if (!window.isSecureContext) throw new AppError('PERMISSION_DENIED', 'microphone needs HTTPS');
    const generation = this.generation;
    let stream: MediaStream;
    // Switch the route before opening the mic. Doing it afterwards leaves iOS on playback and the
    // new stream never delivers samples.
    setAudioSession('play-and-record');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setAudioSession('auto');
      const name = (error as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        throw new AppError('PERMISSION_DENIED', 'microphone permission denied');
      }
      throw new AppError('RECORDER', `could not open microphone (${name ?? 'unknown'})`);
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      setAudioSession('auto');
      throw new AppError('RECORDER', 'recording cancelled');
    }
    // The microphone is only warming up here; nothing is captured until start(). Keep the
    // indicator off so an open (but idle) microphone never looks like an active recording.
    stream.getAudioTracks().forEach((t) => (t.enabled = false));
    return stream;
  }

  /**
   * Opens the microphone (permission + hardware wake-up can take 0.5-2 s, especially on iPhone)
   * while the spoken prompt is still playing, so start() later is instant. Nothing is recorded.
   */
  prepare(): Promise<void> {
    if (this.recorder) return Promise.resolve();
    if (!this.ready) this.ready = this.openStream();
    const pending = this.ready;
    return pending.then(
      () => undefined,
      () => {
        if (this.ready === pending) this.ready = null; // start() will retry and surface the real error
      },
    );
  }

  async start(): Promise<void> {
    if (this.recorder) this.release();
    const generation = this.generation;
    this.ready ??= this.openStream();
    const pending = this.ready;
    let stream: MediaStream;
    try {
      stream = await pending;
    } finally {
      if (this.ready === pending) this.ready = null;
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      setAudioSession('auto');
      throw new AppError('RECORDER', 'recording cancelled');
    }
    // Re-enable the track that prepare() muted, so capture (and the mic indicator) starts now.
    stream.getAudioTracks().forEach((t) => (t.enabled = true));
    this.stream = stream;
    this.chunks = [];
    this.startedAt = Date.now();
    // Safari's audio/mp4 often only indexes the first second. A PCM WAV contains the whole utterance.
    // MediaRecorder remains the fallback when AudioContext cannot start (it still is one blob, not
    // 1-second slices: concatenating those slices is itself only decodable for the first second).
    const pcm = await PcmCapture.tryStart(stream);
    if (generation !== this.generation) {
      pcm?.detach();
      stream.getTracks().forEach((t) => t.stop());
      setAudioSession('auto');
      throw new AppError('RECORDER', 'recording cancelled');
    }
    if (pcm) {
      this.pcm = pcm;
      return;
    }
    // The stream was just attached to Web Audio. iOS often gives MediaRecorder an empty blob for
    // that same stream, which is the "recording failed" error on the second sentence.
    stream.getTracks().forEach((t) => t.stop());
    stream = await this.openStream();
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      setAudioSession('auto');
      throw new AppError('RECORDER', 'recording cancelled');
    }
    stream.getAudioTracks().forEach((t) => (t.enabled = true));
    this.stream = stream;
    const mimeType = pickRecorderMimeType();
    try {
      this.recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      throw new AppError('RECORDER', 'could not create MediaRecorder');
    }
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<AudioData> {
    if (this.pcm) {
      const durationMs = Date.now() - this.startedAt;
      try {
        const audio = this.pcm.finish(durationMs);
        if (audio.bytes.length <= 44) throw new AppError('RECORDER', 'recording produced no audio');
        return audio;
      } finally {
        this.release();
      }
    }
    const recorder = this.recorder;
    if (!recorder) throw new AppError('RECORDER', 'not recording');
    const durationMs = Date.now() - this.startedAt;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/mp4';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.release();
    if (blob.size === 0) throw new AppError('RECORDER', 'recording produced no audio');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType, durationMs };
  }

  cancel(): void {
    this.generation += 1;
    this.release();
  }

  private release(): void {
    this.pcm?.detach();
    this.pcm = null;
    const warm = this.ready;
    this.ready = null;
    warm?.then((s) => s.getTracks().forEach((t) => t.stop()), () => undefined);
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    // Hand the route back so the next spoken prompt or translation uses the loudspeaker.
    setAudioSession('auto');
  }
}

/** Anything that hands out the next scripted utterance (MockScript in the app, a list in tests). */
export interface UtteranceSource {
  next(): string;
}

/**
 * Mock-preset recorder: produces tiny placeholder audio that carries the next SCRIPTED
 * utterance for the deterministic Mock ASR. If `inner` is given (real mic), the real audio is
 * captured too (to test permission/MIME/segments on a phone) and just decorated with the script.
 */
export class ScriptedRecorder implements Recorder {
  private startedAt = 0;
  private live = false;

  constructor(
    private readonly script: UtteranceSource,
    private readonly inner?: Recorder,
  ) {}

  async start(): Promise<void> {
    if (this.inner) await this.inner.start();
    this.startedAt = Date.now();
    this.live = true;
  }

  async stop(): Promise<AudioData> {
    if (!this.live) throw new AppError('RECORDER', 'not recording');
    this.live = false;
    const utterance = this.script.next();
    if (this.inner) {
      const real = await this.inner.stop();
      return { ...real, mockTranscript: utterance };
    }
    return {
      bytes: new Uint8Array([0, 1, 2, 3]),
      mimeType: 'audio/x-mock',
      durationMs: Date.now() - this.startedAt,
      mockTranscript: utterance,
    };
  }

  cancel(): void {
    this.live = false;
    this.inner?.cancel();
  }
}
