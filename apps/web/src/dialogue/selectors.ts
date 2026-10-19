import type { SnapshotFrom } from 'xstate';
import type { DialogueMachine } from './machine';
import type { DialogueEvent } from './types';

export type DialogueSnapshot = SnapshotFrom<DialogueMachine>;
export type Send = (event: DialogueEvent) => void;

export type Screen =
  | 'home'
  | 'recording'
  | 'segmentDecision'
  | 'busy'
  | 'clarify'
  | 'confirm'
  | 'result'
  | 'switch'
  | 'error'
  | 'fallback'
  | 'asrEmpty';

/** Maps the ONE machine's state to one of the child-oriented screens. */
export function screenOf(s: DialogueSnapshot): Screen {
  if (s.matches('idle')) return 'home';
  if (s.matches('confirmingSwitch')) return 'switch';
  if (s.matches({ task: 'recording' })) return 'recording';
  if (s.matches({ task: 'segmentDecision' })) return 'segmentDecision';
  if (s.matches({ task: { clarifying: 'asking' } })) return 'clarify';
  if (s.matches({ task: { confirming: 'asking' } })) return 'confirm';
  if (s.matches({ task: 'result' }) && !s.matches({ task: { result: 'synthesizing' } })) return 'result';
  if (s.matches({ task: 'recoverableError' })) return 'error';
  if (s.matches({ task: 'fallback' })) return 'fallback';
  if (s.matches({ task: 'asrEmpty' })) return 'asrEmpty';
  return 'busy';
}

export type BusyStage = 'asr' | 'interpret' | 'translate' | 'tts';

export function busyStage(s: DialogueSnapshot): BusyStage {
  if (s.matches({ task: 'transcribing' })) return 'asr';
  if (s.matches({ task: 'interpreting' })) return 'interpret';
  if (s.matches({ task: 'translating' })) return 'translate';
  return 'tts';
}

export const BUSY_LABEL: Record<BusyStage, string> = {
  asr: '识别语音… / Lyssnar…',
  interpret: '理解意思… / Förstår…',
  translate: '翻译中… / Översätter…',
  tts: '准备语音… / Förbereder ljud…',
};
