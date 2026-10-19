import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS } from '@kt/shared';
import { audioStore, player } from '../services/runtime';
import type { PlaybackSlot } from '../dialogue/types';

/** Seconds left in the current 30 s segment, derived from the machine's segmentStartedAt. */
export function useCountdown(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active, startedAt]);
  if (!active || startedAt === null) return LIMITS.segmentSeconds;
  const elapsed = Math.max(0, now - startedAt) / 1000;
  return Math.max(0, LIMITS.segmentSeconds - elapsed);
}

export type PlaybackState = {
  playing: boolean;
  /** Browser refused autoplay or failed to play: show the manual Play button prominently. */
  blocked: boolean;
  failed: boolean;
  play: () => void;
};

/**
 * Plays the app-spoken clip of a slot. `autoPlay` tries once when the clip becomes available;
 * Safari may block it, hence the explicit Play button (`blocked`).
 * `onEnded` fires only when playback COMPLETED (not when interrupted).
 */
export function usePlayback(slot: PlaybackSlot, ready: boolean, autoPlay: boolean, onEnded?: () => void): PlaybackState {
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });

  const play = useCallback(() => {
    const audio = audioStore.getPlayback(slot);
    if (!audio) return;
    setPlaying(true);
    setBlocked(false);
    setFailed(false);
    player.play(audio).then(
      (result) => {
        setPlaying(false);
        if (result === 'ended') onEndedRef.current?.();
      },
      (error: unknown) => {
        setPlaying(false);
        const name = (error as { name?: string }).name;
        if (name === 'NotAllowedError') setBlocked(true);
        else setFailed(true);
      },
    );
  }, [slot]);

  useEffect(() => {
    if (ready && autoPlay) play();
    return () => player.stop();
    // Re-run only when a (new) clip becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoPlay]);

  return { playing, blocked, failed, play };
}
