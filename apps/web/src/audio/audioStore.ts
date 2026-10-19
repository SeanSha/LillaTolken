import type { AudioData } from '@kt/shared';
import type { AudioStoreLike, PlaybackSlot } from '../dialogue/types';

/**
 * Volatile, in-memory audio only. Never written to disk, localStorage, XState snapshots or
 * evaluation logs. Cleared on task completion/cancellation and at session end.
 */
export class AudioStore implements AudioStoreLike {
  private segments = new Map<string, AudioData[]>();
  private playback = new Map<PlaybackSlot, AudioData>();

  addSegment(taskId: string, audio: AudioData): void {
    const list = this.segments.get(taskId) ?? [];
    list.push(audio);
    this.segments.set(taskId, list);
  }

  getSegments(taskId: string): AudioData[] {
    return [...(this.segments.get(taskId) ?? [])];
  }

  clearSegments(taskId: string): void {
    this.segments.delete(taskId);
  }

  setPlayback(slot: PlaybackSlot, audio: AudioData): void {
    this.playback.set(slot, audio);
  }

  getPlayback(slot: PlaybackSlot): AudioData | null {
    return this.playback.get(slot) ?? null;
  }

  clearPlayback(slot: PlaybackSlot): void {
    this.playback.delete(slot);
  }

  clearAll(): void {
    this.segments.clear();
    this.playback.clear();
  }

  /** For tests / debugging: counts only, never content. */
  stats(): { segmentTasks: number; playbackSlots: number } {
    return { segmentTasks: this.segments.size, playbackSlots: this.playback.size };
  }
}
