// Pairs one system utterance with the interaction that caused it, on a single monotonic clock.
// Interface prompts (start / continue / switch / error) never enter this tracker.
// A missing trigger leaves the latency unset. It is never stored as zero.
import type { ResponseTrigger, ResponseType } from '@kt/shared';

export type PlaybackSample = {
  responseId: string;
  responseType: ResponseType;
  responseTrigger?: ResponseTrigger;
  /** Present only when this audible start has a trigger on the same clock. */
  responseLatencyMs?: number;
};

type PendingTrigger = { at: number; kind: ResponseTrigger };

type Armed = {
  responseId: string;
  responseType: ResponseType;
  triggerAt: number | null;
  trigger: ResponseTrigger | null;
  counted: boolean;
};

/**
 * One armed response at a time. The pending trigger is the latest unpaired input:
 * speech submitted (`audio_input`) or the confirmation Yes tap (`confirmation_tap`).
 * `arm` consumes that trigger. A later response must not reuse an earlier input.
 * TTS retries keep the unplayed response (and its original trigger) instead of starting a new wait.
 */
export class ResponseLatencyTracker {
  private pending: PendingTrigger | null = null;
  private armed: Armed | null = null;
  private seq = 0;

  constructor(private readonly newId: () => string = () => `rsp${++this.seq}`) {}

  noteInputFinished(at: number): void {
    this.pending = { at, kind: 'audio_input' };
  }

  noteConfirmationTap(at: number): void {
    this.pending = { at, kind: 'confirmation_tap' };
  }

  /**
   * The next spoken clarification, confirmation, or translation is known.
   * Re-arming the same type while that response is still unplayed and no newer trigger
   * has arrived (a TTS retry) keeps the original id and trigger.
   */
  arm(responseType: ResponseType): string {
    if (this.armed && !this.armed.counted && this.armed.responseType === responseType && this.pending === null) {
      return this.armed.responseId;
    }
    const trigger = this.pending;
    this.pending = null;
    const responseId = this.newId();
    this.armed = {
      responseId,
      responseType,
      triggerAt: trigger?.at ?? null,
      trigger: trigger?.kind ?? null,
      counted: false,
    };
    return responseId;
  }

  /**
   * First time the armed clip actually starts playing. A second call (resume, retry, replay)
   * returns null so the same response is not measured twice.
   */
  noteAudibleStart(at: number): PlaybackSample | null {
    const armed = this.armed;
    if (!armed || armed.counted) return null;
    armed.counted = true;
    const sample: PlaybackSample = { responseId: armed.responseId, responseType: armed.responseType };
    if (armed.trigger !== null && armed.triggerAt !== null && at >= armed.triggerAt) {
      sample.responseTrigger = armed.trigger;
      sample.responseLatencyMs = at - armed.triggerAt;
    }
    return sample;
  }

  /** Text-only delivery: the armed speech will not be heard. Do not invent a latency. */
  abandonUnplayed(): void {
    if (this.armed && !this.armed.counted) this.armed = null;
  }

  /** New task or cancellation. Drops an unpaired trigger without writing a zero. */
  reset(): void {
    this.pending = null;
    this.armed = null;
  }

  peek(): Readonly<Armed> | null {
    return this.armed ? { ...this.armed } : null;
  }
}
