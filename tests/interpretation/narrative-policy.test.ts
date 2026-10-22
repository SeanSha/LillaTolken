// Deterministic checks for the p3 narrative policy. These do not call a cloud model.
import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { InterpretationResultSchema, TranslateResponseSchema } from '@kt/shared';
import { loadConfig } from '../../apps/server/src/config';
import { OpenAIDialogueModel, cloudModelTag } from '../../apps/server/src/providers/cloud';
import {
  INTERPRET_JSON_SCHEMA,
  INTERPRET_SYSTEM_PROMPT,
  PROMPT_VERSION,
  TRANSLATE_JSON_SCHEMA,
  TRANSLATE_SV_TO_ZH_PROMPT,
  TRANSLATE_ZH_TO_SV_PROMPT,
} from '../../apps/server/src/providers/cloud/prompts';
import { parseInterpretation, parseTranslation } from '../../apps/server/src/providers/dialogueParsing';
import { NARRATIVE_SCENARIOS, assessNarrative, type NarrativeScenario } from '../../apps/server/scripts/narrativeScenarios';

const cfg = loadConfig({ OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv).openai;
const meta = { taskId: 'narrative', requestId: 'narrative-1' };

const llmClient = (content: string) =>
  ({ chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content } }] })) } } }) as unknown as OpenAI;

function scenario(id: string): NarrativeScenario {
  const found = NARRATIVE_SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function propose(meaningZh: string) {
  return { kind: 'PROPOSE_MEANING' as const, meaningZh };
}

describe('p3 prompt contract', () => {
  it('bumps the pinned prompt version so later runs are distinguishable from p2', () => {
    expect(PROMPT_VERSION).toBe('p3');
    expect(cloudModelTag(cfg)).toContain('prompt=p3');
    expect(INTERPRET_JSON_SCHEMA.required).toEqual(['kind', 'meaningZh', 'questionZh', 'reasonCode']);
    expect(INTERPRET_JSON_SCHEMA.properties.kind.enum).toEqual(['PROPOSE_MEANING', 'ASK_CLARIFICATION', 'UNRESOLVED']);
    expect(TRANSLATE_JSON_SCHEMA.required).toEqual(['translation']);
  });

  it('asks the interpreter to communicate the essential story and still ask when the referent is missing', () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain('faithful communication, not complete information gathering');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('Use more than one short sentence');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('Do not clarify optional details');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('the name of a game');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('died while playing a game');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('Do not treat the whole clarification answer as a new task');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('Do not keep a rejected identity');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('An incomplete story is not automatically unresolved');
    expect(INTERPRET_SYSTEM_PROMPT).toContain('you MUST NOT choose ASK_CLARIFICATION');
    expect(INTERPRET_SYSTEM_PROMPT).not.toContain('one short, simple, complete Mandarin sentence');
  });

  it('lets a confirmed Chinese narrative become more than one Swedish sentence, without added courtesy', () => {
    expect(TRANSLATE_ZH_TO_SV_PROMPT).toContain('already confirmed');
    expect(TRANSLATE_ZH_TO_SV_PROMPT).toContain('as many natural Swedish sentences');
    expect(TRANSLATE_ZH_TO_SV_PROMPT).toContain('Do not add courtesy words');
    expect(TRANSLATE_ZH_TO_SV_PROMPT).not.toContain('at most one short sentence');
    expect(TRANSLATE_ZH_TO_SV_PROMPT).not.toContain('include it');
    expect(TRANSLATE_SV_TO_ZH_PROMPT).toContain('Do not explain.');
    expect(TRANSLATE_SV_TO_ZH_PROMPT).not.toContain('Swedish sentences');
  });

  it('sends the p3 interpretation prompt and the full clarification context', async () => {
    const client = llmClient(JSON.stringify({ kind: 'PROPOSE_MEANING', meaningZh: '我跟弟弟玩游戏，他哭了。游戏里有怪兽。', questionZh: '', reasonCode: '' }));
    const model = new OpenAIDialogueModel(client, cfg);
    const c06 = scenario('C06');
    await model.interpretChinese({ dialogueInputs: c06.dialogueInputs, remainingClarifications: 2 }, meta);
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    const params = create.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(params.messages[0]).toMatchObject({ role: 'system', content: INTERPRET_SYSTEM_PROMPT });
    const user = JSON.parse(params.messages[1]?.content ?? '{}') as { dialogueInputs: typeof c06.dialogueInputs; remainingClarifications: number };
    expect(user.remainingClarifications).toBe(2);
    expect(user.dialogueInputs).toEqual(c06.dialogueInputs);
  });

  it('sends the multi-sentence Swedish prompt only for confirmed Chinese-to-Swedish text', async () => {
    const client = llmClient(JSON.stringify({ translation: 'Jag lekte med min lillebror. Han grät länge.' }));
    const model = new OpenAIDialogueModel(client, cfg);
    await model.translate({ text: '我和弟弟玩游戏。他哭了很久。', direction: 'ZH_TO_SV' }, meta);
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    const params = create.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(params.messages[0]?.content).toBe(TRANSLATE_ZH_TO_SV_PROMPT);
    expect(parseTranslation({ translation: 'Jag lekte med min lillebror. Han grät länge.' })).toBe('Jag lekte med min lillebror. Han grät länge.');
    expect(TranslateResponseSchema.safeParse({ translation: 'En mening. En till.' }).success).toBe(true);
  });
});

describe('narrative policy rubric', () => {
  it('covers C01–C08 and still requires clarification for a missing referent', () => {
    expect(NARRATIVE_SCENARIOS.map((item) => item.id)).toEqual(['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08']);
    const kinds = NARRATIVE_SCENARIOS.flatMap((item) => item.cases.map((itemCase) => itemCase.expectKind));
    expect(kinds).toContain('PROPOSE_MEANING');
    expect(kinds).toContain('ASK_CLARIFICATION');
    expect(kinds).toContain('UNRESOLVED');
  });

  it('accepts different wordings of the same story', () => {
    const c01 = scenario('C01');
    const spoken = propose('我和弟弟玩游戏的时候，他在游戏里死了，然后哭了很久。');
    const paraphrase = propose('弟弟和我一起玩。他在游戏里面死掉了。他哭了很长时间。');
    expect(assessNarrative(c01, 0, spoken).ok).toBe(true);
    expect(assessNarrative(c01, 0, paraphrase).ok).toBe(true);
    expect(spoken.meaningZh).not.toBe(paraphrase.meaningZh);
  });

  it('rejects an unnecessary game question and a story that drops the crying', () => {
    const c01 = scenario('C01');
    expect(assessNarrative(c01, 0, { kind: 'ASK_CLARIFICATION', questionZh: '玩什么游戏？', reasonCode: 'GAME' }).ok).toBe(false);
    expect(assessNarrative(c01, 0, propose('我和弟弟在玩游戏。')).reasons.join(' ')).toContain('哭');
    expect(assessNarrative(c01, 0, propose('我和弟弟玩王者荣耀，他在游戏里死了，然后哭了很久。')).reasons.join(' ')).toContain('王者荣耀');
  });

  it('keeps both events in a longer story and both requests', () => {
    expect(assessNarrative(scenario('C02'), 0, propose('今天我和妈妈出去，下雨了，我们就跑回来。我的鞋子湿了。')).ok).toBe(true);
    expect(assessNarrative(scenario('C02'), 0, propose('今天下雨了。')).ok).toBe(false);
    expect(assessNarrative(scenario('C03'), 0, propose('我想告诉老师，昨天那个男孩一直拿我的玩具。我不喜欢这样。')).ok).toBe(true);
    expect(assessNarrative(scenario('C07'), 0, propose('我想喝水，还想去厕所，因为我刚才跑了很久。')).ok).toBe(true);
    expect(assessNarrative(scenario('C07'), 0, propose('我想喝水。')).ok).toBe(false);
  });

  it('still asks when 那个 has no referent, and stops asking after the budget is gone', () => {
    const c04 = scenario('C04');
    const c05 = scenario('C05');
    expect(assessNarrative(c04, 0, { kind: 'ASK_CLARIFICATION', questionZh: '你想要什么？', reasonCode: 'REFERENT' }).ok).toBe(true);
    expect(assessNarrative(c04, 0, propose('我想要那个球。')).ok).toBe(false);
    expect(assessNarrative(c05, 0, { kind: 'ASK_CLARIFICATION', questionZh: '是什么？', reasonCode: 'REFERENT' }).ok).toBe(true);
    expect(assessNarrative(c05, 1, { kind: 'UNRESOLVED', reasonCode: 'ESSENTIAL_UNCLEAR' }).ok).toBe(true);
    expect(assessNarrative(c05, 1, propose('我想说一件事。')).ok).toBe(false);
    expect(assessNarrative(c05, 0, { kind: 'UNRESOLVED', reasonCode: 'GAVE_UP' }).ok).toBe(false);
  });

  it('reads a long clarification answer as context for the original story', () => {
    const c06 = scenario('C06');
    expect(c06.dialogueInputs[1]).toMatchObject({ purpose: 'CLARIFICATION', inReplyTo: '玩什么游戏？' });
    expect(assessNarrative(c06, 0, propose('我跟弟弟玩游戏，他哭了。那个游戏有怪兽，怪兽一直跑来跑去。')).ok).toBe(true);
    expect(assessNarrative(c06, 0, propose('有一个有怪兽的游戏。')).ok).toBe(false);
    expect(assessNarrative(c06, 0, { kind: 'ASK_CLARIFICATION', questionZh: '怪兽叫什么？', reasonCode: 'DETAIL' }).ok).toBe(false);
  });

  it('applies a correction without keeping the rejected sibling as fact', () => {
    const c08 = scenario('C08');
    expect(c08.dialogueInputs.map((input) => input.purpose)).toEqual(['INITIAL', 'CORRECTION']);
    expect(assessNarrative(c08, 0, propose('我跟哥哥玩游戏，他哭了。')).ok).toBe(true);
    expect(assessNarrative(c08, 0, propose('我说的是哥哥，不是弟弟。我们玩游戏，他哭了。')).ok).toBe(true);
    expect(assessNarrative(c08, 0, propose('我跟弟弟玩游戏，他哭了。')).reasons.join(' ')).toContain('弟弟');
    expect(assessNarrative(c08, 0, propose('我说的是哥哥。')).ok).toBe(false);
  });

  it('turns a late clarification question about an unclear referent into UNRESOLVED', () => {
    const asked = { kind: 'ASK_CLARIFICATION', questionZh: '是什么？', reasonCode: 'REFERENT' };
    expect(parseInterpretation(asked, 0)).toEqual({ kind: 'UNRESOLVED', reasonCode: 'CLARIFICATION_BUDGET_EXHAUSTED' });
    expect(InterpretationResultSchema.safeParse(parseInterpretation(asked, 0)).success).toBe(true);
    const narrative = propose('我和弟弟玩游戏。他在游戏里死了。他哭了很久。我觉得很麻烦。');
    expect(narrative.meaningZh.length).toBeLessThan(500);
    expect(InterpretationResultSchema.safeParse(narrative).success).toBe(true);
  });
});
