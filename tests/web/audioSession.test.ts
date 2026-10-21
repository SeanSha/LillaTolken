import { afterEach, describe, expect, it } from 'vitest';
import { setAudioSession } from '../../apps/web/src/audio/session';

const original = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
});

describe('iOS audio session', () => {
  it('switches the route when the browser exposes one, and ignores a rejected assignment', () => {
    const session = { type: 'auto' };
    Object.defineProperty(globalThis, 'navigator', { value: { audioSession: session }, configurable: true });
    setAudioSession('play-and-record');
    expect(session.type).toBe('play-and-record');
    setAudioSession('play-and-record');
    expect(session.type).toBe('play-and-record');

    Object.defineProperty(session, 'type', {
      set() {
        throw new Error('unsupported');
      },
      get() {
        return 'playback';
      },
    });
    expect(() => setAudioSession('auto')).not.toThrow();
  });
});
