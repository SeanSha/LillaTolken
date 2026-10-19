// ~20 ARTIFICIAL, non-identifying scenarios for the text-only Cloud-vs-Local feasibility run
// (docs/SYSTEM_DESIGN.md 7.3): 5 clear zh->sv, 10 fragmented/ambiguous zh, 5 sv->zh.
// Nothing here is real child speech or personal data.
export type ZhScenario = {
  id: string;
  segments: string[];
  /** What the interpretation step should do under the dialogue policy (informational check only). */
  expect: 'PROPOSE' | 'ASK' | 'ANY';
  /** Simulated adult answer if the model asks a clarification question. */
  answer?: string;
};
export type SvScenario = { id: string; text: string };

export const ZH_SCENARIOS: ZhScenario[] = [
  { id: 'Z01-clear', segments: ['我想去厕所。'], expect: 'PROPOSE' },
  { id: 'Z02-clear', segments: ['我想喝水。'], expect: 'PROPOSE' },
  { id: 'Z03-clear', segments: ['我肚子饿了。'], expect: 'PROPOSE' },
  { id: 'Z04-clear', segments: ['我想回家。'], expect: 'PROPOSE' },
  { id: 'Z05-clear', segments: ['我很冷，我想要外套。'], expect: 'PROPOSE' },
  { id: 'Z06-frag', segments: ['老师', '他把我的', '水壶拿走了。'], expect: 'ANY' },
  { id: 'Z07-ambig', segments: ['他拿走了我的那个。'], expect: 'ASK', answer: '我的水壶。' },
  { id: 'Z08-ambig', segments: ['我想要那个。'], expect: 'ASK', answer: '红色的球。' },
  { id: 'Z09-ambig', segments: ['我们去那里吧。'], expect: 'ASK', answer: '去操场。' },
  { id: 'Z10-frag', segments: ['妈妈说', '不可以。'], expect: 'ANY', answer: '不可以吃糖。' },
  { id: 'Z11-ambig', segments: ['我不喜欢', '它。'], expect: 'ASK', answer: '那只狗。' },
  { id: 'Z12-ambig', segments: ['给我', '红色的。'], expect: 'ASK', answer: '红色的铅笔。' },
  { id: 'Z13-ambig', segments: ['他推我了。'], expect: 'ANY', answer: '小明推我。' },
  { id: 'Z14-frag', segments: ['我的肚子', '有点', '不舒服。'], expect: 'PROPOSE' },
  { id: 'Z15-frag', segments: ['昨天', '我们', '去了', '公园。'], expect: 'PROPOSE' },
];

export const SV_SCENARIOS: SvScenario[] = [
  { id: 'S01', text: 'Jag vill gå på toaletten.' },
  { id: 'S02', text: 'Kan jag få lite vatten?' },
  { id: 'S03', text: 'Jag är hungrig.' },
  { id: 'S04', text: 'Vi ska gå hem nu.' },
  { id: 'S05', text: 'Läraren sa att vi ska vänta här.' },
];
