// Deterministic Mock provider (docs/SYSTEM_DESIGN.md 5.1). No network, no randomness.
// It exercises the REAL dialogue machine: clear Chinese, ambiguity, clarification answers,
// confirmation No, Swedish input, and one-shot recoverable errors via markers in scripted input.
import {
  AppError,
  type AudioData,
  type DialogueModel,
  type InterpretationResult,
  type InterpretInput,
  type Language,
  type ProviderBundle,
  type RequestMeta,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type TranslateInput,
} from '@kt/shared';
import { makeToneWav } from './wav';

export const MOCK_MODEL_TAG = 'mock-v1';

const MARKER_RE = /\[(EMPTY|NETWORK_ERROR|MALFORMED)\]/g;
const hasMarker = (s: string, name: string) => s.includes(`[${name}]`);
const stripMarkers = (s: string) => s.replace(MARKER_RE, '');

/** Strip markers + surrounding punctuation of each fragment and glue fragments together. */
export function normalizeParts(parts: string[]): string {
  return parts
    .map((p) => stripMarkers(p).replace(/^[\s…。.,，、！？!?]+|[\s…。.,，、！？!?]+$/g, ''))
    .join('');
}

const ZH_MEANINGS: Record<string, string> = {
  老师他把我的水壶拿走了: '老师把我的水壶拿走了。',
  我想去厕所: '我想去厕所。',
};

const ZH_TO_SV: Record<string, string> = {
  '我想去厕所。': 'Jag vill gå på toaletten.',
  '老师把我的水壶拿走了。': 'Läraren tog min vattenflaska.',
  '他拿走了我的水壶。': 'Han tog min vattenflaska.',
  '我想吃苹果。': 'Jag vill äta ett äpple.',
  '我想喝水。': 'Jag vill dricka vatten.',
};

const SV_TO_ZH: Record<string, string> = {
  'lägg boken på bordet.': '把书放在桌子上。',
  'jag vill gå på toaletten.': '我想去厕所。',
  'var är min vattenflaska?': '我的水壶在哪里？',
  'hej!': '你好！',
};

const QUESTIONS = [
  '你说的“那个”，是指什么呢？',
  '可以再说清楚一点吗？是什么呢？',
  '最后再问一次，是指什么呢？',
];

const AMBIGUOUS_WORDS = /那个|这个/;
const NON_ANSWER = /^(嗯|不知道|那个|这个)/;

export class MockSpeechRecognizer implements SpeechRecognizer {
  private readonly failedOnce = new Set<string>();

  async transcribe(audio: AudioData, _language: Language, meta: RequestMeta): Promise<string> {
    const raw = audio.mockTranscript ?? '';
    if (hasMarker(raw, 'NETWORK_ERROR') && !this.failedOnce.has(meta.taskId)) {
      this.failedOnce.add(meta.taskId);
      throw new AppError('NETWORK', 'mock network error');
    }
    if (hasMarker(raw, 'EMPTY')) return '';
    // [MALFORMED] intentionally survives ASR: it is consumed by the (mock) interpretation stage.
    return raw.replace(/\[(EMPTY|NETWORK_ERROR)\]/g, '').trim();
  }
}

export class MockDialogueModel implements DialogueModel {
  private readonly malformedOnce = new Set<string>();

  async interpretChinese(input: InterpretInput, meta: RequestMeta): Promise<InterpretationResult> {
    const allRaw = input.dialogueInputs.flatMap((d) => d.textParts);
    if (allRaw.some((p) => hasMarker(p, 'MALFORMED')) && !this.malformedOnce.has(meta.taskId)) {
      this.malformedOnce.add(meta.taskId);
      throw new AppError('INVALID_MODEL_OUTPUT', 'mock malformed model output');
    }

    // The latest INITIAL/CORRECTION input is the base; later CLARIFICATION inputs answer questions.
    let baseIndex = -1;
    input.dialogueInputs.forEach((d, i) => {
      if (d.purpose !== 'CLARIFICATION') baseIndex = i;
    });
    const base = input.dialogueInputs[baseIndex] ?? input.dialogueInputs[0];
    if (!base) return { kind: 'UNRESOLVED', reasonCode: 'NO_INPUT' };
    const answers = input.dialogueInputs.slice(baseIndex + 1).filter((d) => d.purpose === 'CLARIFICATION');
    const baseText = normalizeParts(base.textParts);

    const askOrUnresolved = (): InterpretationResult =>
      input.remainingClarifications > 0
        ? {
            kind: 'ASK_CLARIFICATION',
            questionZh: QUESTIONS[Math.min(answers.length, QUESTIONS.length - 1)] ?? QUESTIONS[0]!,
            reasonCode: 'UNRESOLVED_REFERENT',
          }
        : { kind: 'UNRESOLVED', reasonCode: 'CLARIFICATION_BUDGET_EXHAUSTED' };

    if (baseText === '') return { kind: 'UNRESOLVED', reasonCode: 'EMPTY_INPUT' };

    if (AMBIGUOUS_WORDS.test(baseText)) {
      const last = answers[answers.length - 1];
      if (!last) return askOrUnresolved();
      const answer = normalizeParts(last.textParts);
      if (answer === '' || NON_ANSWER.test(answer)) return askOrUnresolved();
      return { kind: 'PROPOSE_MEANING', meaningZh: `${baseText.replace(AMBIGUOUS_WORDS, answer)}。` };
    }

    return { kind: 'PROPOSE_MEANING', meaningZh: ZH_MEANINGS[baseText] ?? `${baseText}。` };
  }

  async translate(input: TranslateInput): Promise<string> {
    const text = input.text.trim();
    if (input.direction === 'ZH_TO_SV') return ZH_TO_SV[text] ?? `[SV] ${text}`;
    return SV_TO_ZH[text.toLowerCase()] ?? `[中文] ${text}`;
  }
}

export class MockSpeechSynthesizer implements SpeechSynthesizer {
  async synthesize(text: string, language: Language): Promise<AudioData> {
    const durationMs = Math.min(2500, 350 + text.length * 40);
    return {
      bytes: makeToneWav({ frequencyHz: language === 'zh' ? 523 : 392, durationMs }),
      mimeType: 'audio/wav',
      durationMs,
    };
  }
}

export function createMockProvider(): ProviderBundle {
  return {
    asr: new MockSpeechRecognizer(),
    dialogue: new MockDialogueModel(),
    tts: new MockSpeechSynthesizer(),
  };
}
