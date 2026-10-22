import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../../apps/web/src/audio/player';
import { ResponseLatencyTracker } from '../../apps/web/src/dialogue/responseLatency';

class FakeAudio {
  preload = '';
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  setAttribute(): void {}
  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  emit(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

let current: FakeAudio | null = null;

function FakeCtor() {
  current = new FakeAudio();
  return current;
}

const audio = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/wav' };

afterEach(() => {
  current = null;
  vi.unstubAllGlobals();
});

describe('audible playback detection', () => {
  it('fires on the playing event once, not when play() is called or the clip ends', async () => {
    vi.stubGlobal('Audio', FakeCtor);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
    const player = new AudioPlayer();
    const heard: string[] = [];
    const pending = player.play(audio, { onAudible: () => heard.push('playing') });
    await Promise.resolve();
    expect(heard).toEqual([]);
    current!.emit('playing');
    current!.emit('playing');
    expect(heard).toEqual(['playing']);
    current!.onended?.();
    expect(heard).toEqual(['playing']);
    await expect(pending).resolves.toBe('ended');
  });

  it('a decode error or a stop before playing is not an audible start', async () => {
    vi.stubGlobal('Audio', FakeCtor);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
    const player = new AudioPlayer();
    const heard: number[] = [];
    const failed = player.play(audio, { onAudible: () => heard.push(1) });
    const rejection = failed.catch((error: unknown) => error);
    current!.onerror?.();
    await expect(rejection).resolves.toBeInstanceOf(Error);
    expect(heard).toEqual([]);

    const stopped = player.play(audio, { onAudible: () => heard.push(2) });
    player.stop();
    current!.emit('playing');
    await expect(stopped).resolves.toBe('stopped');
    expect(heard).toEqual([]);
  });

  it('a second play of the same armed response does not create a second latency', async () => {
    vi.stubGlobal('Audio', FakeCtor);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
    const tracker = new ResponseLatencyTracker();
    tracker.noteInputFinished(100);
    tracker.arm('translation');
    let clock = 100;
    const player = new AudioPlayer();
    const play = () => {
      const pending = player.play(audio, { onAudible: () => tracker.noteAudibleStart((clock += 50)) });
      current!.emit('playing');
      player.stop();
      return pending;
    };
    await play();
    await play();
    expect(tracker.peek()?.counted).toBe(true);
    expect(tracker.noteAudibleStart(999)).toBeNull();
  });
});
