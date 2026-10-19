import { AppError, type AudioData } from '@kt/shared';
import type { Recorder } from '../dialogue/types';

/**
 * Safari (esp. iPhone) records MP4/AAC; Chrome/Firefox record WebM/Opus. Never assume WebM:
 * pick the first type this browser reports as supported.
 */
export const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

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

/** Real microphone recorder (getUserMedia + MediaRecorder). Audio stays in memory. */
export class MediaRecorderRecorder implements Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
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
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        throw new AppError('PERMISSION_DENIED', 'microphone permission denied');
      }
      throw new AppError('RECORDER', `could not open microphone (${name ?? 'unknown'})`);
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
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
      throw new AppError('RECORDER', 'recording cancelled');
    }
    const mimeType = pickRecorderMimeType();
    try {
      this.recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      throw new AppError('RECORDER', 'could not create MediaRecorder');
    }
    // Re-enable the track that prepare() muted, so capture (and the mic indicator) starts now.
    stream.getAudioTracks().forEach((t) => (t.enabled = true));
    this.stream = stream;
    this.chunks = [];
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.startedAt = Date.now();
  }

  async stop(): Promise<AudioData> {
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
