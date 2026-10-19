// Scripted utterances for the deterministic Mock preset. Each utterance is "heard" by the
// Mock ASR in the order the recorder produces audio (initial segments, then answers, ...).
// All content is synthetic.
import type { Direction } from './types';

export type MockScenario = {
  id: string;
  label: string;
  direction: Direction;
  utterances: string[];
  /** What the tester should do / expect. */
  hint: string;
};

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  {
    id: 'T01',
    label: 'T01 清晰句子 我想去厕所',
    direction: 'ZH_TO_SV',
    utterances: ['我想去厕所。'],
    hint: '不需要澄清,但仍要确认意思。点 Finished 后点 ✅。',
  },
  {
    id: 'T02',
    label: 'T02 三段碎片',
    direction: 'ZH_TO_SV',
    utterances: ['老师……', '他把我的……', '水壶拿走了。'],
    hint: '录三段,每段后点 Continue,第三段后点 Finished。',
  },
  {
    id: 'T03',
    label: 'T03 30秒超时',
    direction: 'ZH_TO_SV',
    utterances: ['我想去厕所。'],
    hint: '不要点停止,等 30 秒倒计时结束,只结束这一段。',
  },
  {
    id: 'T04',
    label: 'T04 模糊指代(1次澄清)',
    direction: 'ZH_TO_SV',
    utterances: ['他拿走了我的那个。', '水壶。'],
    hint: '先被问"那个是什么",回答后再确认。',
  },
  {
    id: 'T05',
    label: 'T05 三次澄清失败',
    direction: 'ZH_TO_SV',
    utterances: ['他拿走了我的那个。', '嗯……', '不知道。', '那个啦。'],
    hint: '问三次后不会有第四次问题,进入重来/取消。',
  },
  {
    id: 'T06',
    label: 'T06 确认选 No(纠正)',
    direction: 'ZH_TO_SV',
    utterances: ['我想喝水。', '我想吃苹果。'],
    hint: '第一次确认点 ❌,再录纠正句。',
  },
  {
    id: 'T07',
    label: 'T07 瑞典语 → 中文',
    direction: 'SV_TO_ZH',
    utterances: ['Lägg boken på bordet.'],
    hint: '显示瑞典语识别原文 + 中文翻译 + 中文语音。',
  },
  {
    id: 'T11a',
    label: 'T11 ASR 为空(重录)',
    direction: 'ZH_TO_SV',
    utterances: ['[EMPTY]', '我想去厕所。'],
    hint: '第一段识别为空,提示重录。',
  },
  {
    id: 'T11b',
    label: 'T11 网络错误(重试)',
    direction: 'ZH_TO_SV',
    utterances: ['[NETWORK_ERROR]我想去厕所。'],
    hint: '识别阶段第一次失败,点重试后成功。',
  },
  {
    id: 'T11c',
    label: 'T11 模型 JSON 异常(重试)',
    direction: 'ZH_TO_SV',
    utterances: ['[MALFORMED]我想去厕所。'],
    hint: '理解阶段第一次返回非法 JSON,点重试后成功。',
  },
];

export function findMockScenario(id: string): MockScenario | undefined {
  return MOCK_SCENARIOS.find((s) => s.id === id);
}

/** Hands out scripted utterances one per recorded segment. */
export class MockScript {
  private scenario: MockScenario | undefined;
  private index = 0;

  constructor(scenarioId?: string) {
    this.select(scenarioId);
  }

  select(scenarioId?: string): void {
    this.scenario = scenarioId ? findMockScenario(scenarioId) : undefined;
    this.index = 0;
  }

  reset(): void {
    this.index = 0;
  }

  get scenarioId(): string | undefined {
    return this.scenario?.id;
  }

  get remaining(): string[] {
    return this.scenario ? this.scenario.utterances.slice(this.index) : [];
  }

  /** Next scripted utterance, or '[EMPTY]' (-> empty ASR) when the script is exhausted. */
  next(): string {
    const utterance = this.scenario?.utterances[this.index];
    this.index += 1;
    return utterance ?? '[EMPTY]';
  }
}
