import type { AudioData } from '@kt/shared';
import { setAudioSession } from './session';

// 0.1 s of silence. Played inside a user gesture to "unlock" the shared <audio> element on iOS.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ4AAACAgICAgICAgICAgICA';

export type PlayResult = 'ended' | 'stopped';

/**
 * ONE shared <audio> element. iOS Safari only allows programmatic play() on an element that was
 * started from a user gesture, so `unlock()` is called from the first tap. Autoplay can still be
 * refused, therefore every screen also offers an explicit Play button.
 */
export class AudioPlayer {
  private element: HTMLAudioElement | null = null;
  private url: string | null = null;
  private token = 0;
  private finish: ((r: PlayResult) => void) | null = null;
  private startedAt = 0;
  private lastCompletedMs: number | undefined;

  /** Wall-clock duration of the most recent clip that played to the end (monitoring only). */
  lastPlaybackMs(): number | undefined {
    return this.lastCompletedMs;
  }

  private ensure(): HTMLAudioElement {
    if (!this.element) {
      this.element = new Audio();
      this.element.preload = 'auto';
      this.element.setAttribute('playsinline', '');
    }
    return this.element;
  }

  /** Call synchronously from a tap handler. */
  unlock(): void {
    const el = this.ensure();
    el.src = SILENT_WAV;
    el.play().then(
      () => el.pause(),
      () => undefined,
    );
  }

  /**
   * Resolves 'ended' when playback completes, 'stopped' if interrupted; rejects if the browser refuses/decoding fails.
   * `onAudible` fires once, on the media `playing` event — not when play() is called and not when the file has downloaded.
   * A later `playing` from resume or a second play() of this call is ignored. The caller dedupes replays of the same response.
   */
  play(audio: AudioData, hooks?: { onAudible?: () => void }): Promise<PlayResult> {
    setAudioSession('playback');
    this.stop();
    const el = this.ensure();
    const token = ++this.token;
    const blob = new Blob([audio.bytes as BlobPart], { type: audio.mimeType });
    this.url = URL.createObjectURL(blob);
    el.src = this.url;
    this.startedAt = performance.now();
    return new Promise<PlayResult>((resolve, reject) => {
      let audible = false;
      const onPlaying = () => {
        if (token !== this.token || audible) return;
        audible = true;
        hooks?.onAudible?.();
      };
      const cleanup = () => {
        el.removeEventListener('playing', onPlaying);
        el.onended = null;
        el.onerror = null;
        this.finish = null;
        this.revoke();
      };
      this.finish = (r) => {
        cleanup();
        resolve(r);
      };
      el.addEventListener('playing', onPlaying);
      el.onended = () => {
        if (token !== this.token) return;
        this.lastCompletedMs = Math.round(performance.now() - this.startedAt);
        cleanup();
        resolve('ended');
      };
      el.onerror = () => {
        if (token !== this.token) return;
        cleanup();
        reject(new Error('audio decode/playback error'));
      };
      el.play().catch((error: unknown) => {
        if (token !== this.token) return;
        cleanup();
        reject(error);
      });
    });
  }

  stop(): void {
    this.token += 1;
    const finish = this.finish;
    if (this.element) {
      this.element.onended = null;
      this.element.onerror = null;
      this.element.pause();
    }
    this.finish = null;
    this.revoke();
    finish?.('stopped');
  }

  private revoke(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
