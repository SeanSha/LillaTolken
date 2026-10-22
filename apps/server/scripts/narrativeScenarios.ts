// Artificial narrative cases for the p3 interpretation policy.
// Nothing here is real child speech. Do not replace these with recorded transcripts.
import type { DialogueInput, InterpretationResult } from '@kt/shared';

export type NarrativeKind = InterpretationResult['kind'];

export type NarrativeCase = {
  remainingClarifications: number;
  expectKind: NarrativeKind;
};

export type NarrativeScenario = {
  id: string;
  note: string;
  dialogueInputs: DialogueInput[];
  cases: NarrativeCase[];
  /**
   * Required ideas in a proposed meaning. Each group accepts any one wording,
   * so a paraphrase can pass without matching one exact sentence.
   */
  meaningIncludesAny?: readonly (readonly string[])[];
  /** Facts the meaning must not assert. A phrase in negationPhrases is ignored. */
  meaningMustNotAssert?: readonly string[];
  negationPhrases?: readonly string[];
};

export const NARRATIVE_SCENARIOS: NarrativeScenario[] = [
  {
    id: 'C01',
    note: 'In-game death and crying are enough. The game title is optional.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我和弟弟玩游戏，他在游戏里死了，然后哭了很久。'] }],
    cases: [{ remainingClarifications: 3, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['弟弟'], ['玩'], ['死'], ['哭']],
    meaningMustNotAssert: ['王者荣耀', '我的世界'],
  },
  {
    id: 'C02',
    note: 'Several events in order, including the wet shoes.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['今天我和妈妈出去，然后下雨了，我们就跑回来，我的鞋子都湿了。'] }],
    cases: [{ remainingClarifications: 3, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['妈妈'], ['雨'], ['跑'], ['鞋']],
  },
  {
    id: 'C03',
    note: 'The boy is unnamed, but the complaint is already communicable.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我想告诉老师昨天那个男孩一直拿我的玩具，我不喜欢。'] }],
    cases: [{ remainingClarifications: 3, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['男孩', '他'], ['玩具'], ['不喜欢']],
  },
  {
    id: 'C04',
    note: 'No referent for 那个, so a question is still required.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我想要那个。'] }],
    cases: [{ remainingClarifications: 3, expectKind: 'ASK_CLARIFICATION' }],
  },
  {
    id: 'C05',
    note: 'The child cannot name the referent. Ask while budget remains; stop when it does not.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我不知道怎么说，就是那个……'] }],
    cases: [
      { remainingClarifications: 3, expectKind: 'ASK_CLARIFICATION' },
      { remainingClarifications: 0, expectKind: 'UNRESOLVED' },
    ],
  },
  {
    id: 'C06',
    note: 'A long answer about the game adds context. Keep the original story and do not ask again.',
    dialogueInputs: [
      { purpose: 'INITIAL', textParts: ['我跟弟弟玩游戏，他哭了。'] },
      {
        purpose: 'CLARIFICATION',
        textParts: ['就是那个有怪兽的，然后他一直跑来跑去的游戏。'],
        inReplyTo: '玩什么游戏？',
      },
    ],
    cases: [{ remainingClarifications: 2, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['弟弟'], ['哭'], ['怪兽', '怪物'], ['玩']],
  },
  {
    id: 'C07',
    note: 'Both requests stay in the proposal.',
    dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我想喝水，然后我还想去厕所，因为我刚才跑了很久。'] }],
    cases: [{ remainingClarifications: 3, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['喝水', '水'], ['厕所'], ['跑']],
  },
  {
    id: 'C08',
    note: 'A correction replaces the rejected identity and keeps the rest of the story.',
    dialogueInputs: [
      { purpose: 'INITIAL', textParts: ['我跟弟弟玩游戏，他哭了。'] },
      { purpose: 'CORRECTION', textParts: ['我说的是哥哥，不是弟弟。'] },
    ],
    cases: [{ remainingClarifications: 3, expectKind: 'PROPOSE_MEANING' }],
    meaningIncludesAny: [['哥哥'], ['玩'], ['哭']],
    meaningMustNotAssert: ['弟弟'],
    negationPhrases: ['不是弟弟', '并非弟弟'],
  },
];

function withoutNegations(meaning: string, phrases: readonly string[]): string {
  return phrases.reduce((text, phrase) => text.split(phrase).join(''), meaning);
}

/** Policy check for one model result. It never requires one exact sentence. */
export function assessNarrative(
  scenario: NarrativeScenario,
  caseIndex: number,
  result: InterpretationResult,
): { ok: boolean; reasons: string[] } {
  const spec = scenario.cases[caseIndex];
  if (!spec) return { ok: false, reasons: ['missing case'] };
  const reasons: string[] = [];
  if (result.kind !== spec.expectKind) reasons.push(`kind ${result.kind}, expected ${spec.expectKind}`);
  if (result.kind === 'ASK_CLARIFICATION' && spec.expectKind === 'ASK_CLARIFICATION' && result.questionZh.trim() === '') {
    reasons.push('empty clarification question');
  }
  if (result.kind === 'PROPOSE_MEANING' && spec.expectKind === 'PROPOSE_MEANING') {
    for (const group of scenario.meaningIncludesAny ?? []) {
      if (!group.some((token) => result.meaningZh.includes(token))) {
        reasons.push(`missing one of: ${group.join(' / ')}`);
      }
    }
    const masked = withoutNegations(result.meaningZh, scenario.negationPhrases ?? []);
    for (const token of scenario.meaningMustNotAssert ?? []) {
      if (masked.includes(token)) reasons.push(`asserted ${token}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
