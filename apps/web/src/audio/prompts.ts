import type { Language } from '@kt/shared';
import type { PromptId } from '../dialogue/types';
import { setAudioSession } from './session';

/**
 * Short static prompts. Spoken, so child operation does not depend on reading.
 * The audio files in public/prompts/<id>-<lang>.mp3 are generated from these texts by
 * `node --env-file=.env scripts/gen-prompts.mjs` (keep the two in sync); the text is also the
 * offline fallback (browser speech) if a file cannot be played.
 */
export const PROMPT_TEXT: Record<PromptId, Record<Language, string>> = {
  start: { zh: '请说吧', sv: 'Varsågod' },
  continue: { zh: '还有吗？', sv: 'Något mer?' },
  switch: { zh: '要换一个吗？', sv: 'Vill du byta?' },
  asrEmpty: { zh: '没听清，再说一次好吗？', sv: 'Kan du säga det igen?' },
  fallback: { zh: '我们重新开始吧', sv: 'Vi börjar om' },
  error: { zh: '出了点小问题', sv: 'Något gick fel' },
};

const LANG_TAG: Record<Language, string> = { zh: 'zh-CN', sv: 'sv-SE' };
/** Never block the dialogue on a prompt that does not report its end. */
const MAX_PROMPT_MS = 6000;
/** Fire `onNearEnd` this long before the clip ends (used to wake the microphone without clipping the prompt). */
const NEAR_END_MS = 250;

export type SpeakHooks = {
  /** Called once, shortly before the prompt finishes (or when it finishes / falls back). */
  onNearEnd?: () => void;
};

function promptUrl(id: PromptId, language: Language): string {
  return `${import.meta.env.BASE_URL}prompts/${id}-${language}.mp3`;
}

function pickVoice(tag: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const prefix = tag.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang.replace('_', '-').toLowerCase() === tag.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

/**
 * Static prompts are pre-generated, natural-sounding audio files (no network call to an API, no
 * cost at runtime). They are interface prompts, not translator responses, so they are not
 * response-latency samples. One reused <audio> element keeps iOS Safari's autoplay unlock. If a file
 * cannot be played, falls back to the browser's built-in speech synthesis. Always resolves.
 */
export class SpeechPrompts {
  private audio: HTMLAudioElement | null = null;
  private current: SpeechSynthesisUtterance | null = null;
  /** Cancels the in-flight prompt (resolves its promise). */
  private cancelCurrent: (() => void) | null = null;

  speak(id: PromptId, language: Language, hooks: SpeakHooks = {}): Promise<void> {
    setAudioSession('playback');
    this.stop();
    return new Promise<void>((resolve) => {
      let done = false;
      let nearEndFired = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const fireNearEnd = () => {
        if (nearEndFired) return;
        nearEndFired = true;
        try {
          hooks.onNearEnd?.();
        } catch {
          // a hook must never break the prompt
        }
      };
      const finish = (opts: { cancelled?: boolean } = {}) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (this.cancelCurrent === cancel) this.cancelCurrent = null;
        if (!opts.cancelled) fireNearEnd();
        resolve();
      };
      const cancel = () => finish({ cancelled: true });
      const timer = setTimeout(() => finish(), MAX_PROMPT_MS);
      this.cancelCurrent = cancel;

      let fellBack = false;
      const fallbackToSpeech = () => {
        if (done || fellBack) return;
        fellBack = true;
        clearInterval(poll);
        this.speakWithBrowserVoice(id, language, () => finish());
      };

      if (typeof Audio === 'undefined') {
        fallbackToSpeech();
        return;
      }
      const audio = (this.audio ??= new Audio());
      audio.onended = () => finish();
      audio.onerror = fallbackToSpeech;
      audio.src = promptUrl(id, language);
      audio.currentTime = 0;
      poll = setInterval(() => {
        if (Number.isFinite(audio.duration) && audio.duration > 0 && (audio.duration - audio.currentTime) * 1000 <= NEAR_END_MS) fireNearEnd();
      }, 40);
      audio.play().catch(fallbackToSpeech);
    });
  }

  private speakWithBrowserVoice(id: PromptId, language: Language, onDone: () => void): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(PROMPT_TEXT[id][language]);
    utterance.lang = LANG_TAG[language];
    const voice = pickVoice(LANG_TAG[language]);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.onend = onDone;
    utterance.onerror = onDone;
    this.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      onDone();
    }
  }

  stop(): void {
    const cancel = this.cancelCurrent;
    this.cancelCurrent = null;
    this.current = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    cancel?.();
  }
}
