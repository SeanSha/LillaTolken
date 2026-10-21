export type AudioSessionType = 'auto' | 'playback' | 'play-and-record';

type AudioSession = { type: string };

function audioSession(): AudioSession | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
}

/**
 * iOS keeps the previous route until it expires. After a prompt or spoken translation the session
 * stays on playback, so the next recording opens a microphone that delivers no samples and then
 * fails. Setting the type explicitly makes the switch happen immediately. `auto` lets the following
 * playback use the loudspeaker again instead of the earpiece.
 */
export function setAudioSession(type: AudioSessionType): void {
  const session = audioSession();
  if (!session || session.type === type) return;
  try {
    session.type = type;
  } catch {
    // Some iOS builds expose the object but reject a type. Leave the current route.
  }
}
