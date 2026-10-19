import { describe, expect, it } from 'vitest';
import { AppError, type DialogueModel, type SpeechRecognizer } from '@kt/shared';
import { createMockProvider } from '../../apps/server/src/providers/mock';
import { createHarness, deferred, deliverTask, toConfirming } from './harness';

describe('Direction switching (T08)', () => {
  it('needs a SEPARATE Yes/No confirmation; No restores a safe checkpoint (mid-recording)', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recording.listening');
    const taskId = h.task().id;

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    expect(h.is('confirmingSwitch')).toBe(true);
    expect(h.ctx().pendingDirection).toBe('SV_TO_ZH');
    expect(h.task().direction).toBe('ZH_TO_SV'); // nothing changed yet
    expect(h.cancelSpy).toHaveBeenCalled(); // live microphone released

    h.send({ type: 'SWITCH_NO' });
    await h.until('task.recording.listening'); // interrupted recording restarted
    expect(h.task().id).toBe(taskId);
    expect(h.task().direction).toBe('ZH_TO_SV');
    expect(h.ctx().pendingDirection).toBeNull();
    expect(h.count('SWITCH_REQUESTED')).toBe(1);
    expect(h.count('SWITCH_NO')).toBe(1);
  });

  it('No keeps earlier segments: returns to Continue/Finished instead of losing them', async () => {
    const h = createHarness({ utterances: ['老师……', '他把我的……'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.until('task.recording.listening');

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    h.send({ type: 'SWITCH_NO' });
    await h.until('task.segmentDecision');
    expect(h.task().pendingSegments).toBe(1);
    expect(h.audioStore.getSegments(h.task().id)).toHaveLength(1);
  });

  it('Yes cancels the unfinished task, starts a fresh task in the new direction and keeps only lastDelivered', async () => {
    const h = createHarness({ utterances: ['我想去厕所。', '他拿走了我的那个。', 'Lägg boken på bordet.'] });
    await deliverTask(h);
    const delivered = h.ctx().lastDelivered;

    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.clarifying.asking');
    const oldTaskId = h.task().id;
    expect(h.task().clarificationCount).toBe(1);

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    h.send({ type: 'SWITCH_YES' });
    await h.until('task.recording');

    expect(h.task().id).not.toBe(oldTaskId);
    expect(h.task().direction).toBe('SV_TO_ZH');
    expect(h.task().clarificationCount).toBe(0);
    expect(h.task().dialogueInputs).toHaveLength(0);
    expect(h.task().currentQuestion).toBeNull();
    expect(h.ctx().lastDelivered).toEqual(delivered);
    expect(h.count('SWITCH_YES')).toBe(1);
    expect(h.count('TASK_CANCELLED')).toBe(1);
  });

  it('switch confirmation and meaning confirmation use different events', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await toConfirming(h);

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    expect(h.is('confirmingSwitch')).toBe(true);
    h.send({ type: 'CONFIRM_YES' }); // meaning-confirmation event must NOT answer the switch question
    h.send({ type: 'CONFIRM_NO' });
    expect(h.is('confirmingSwitch')).toBe(true);
    expect(h.task().confirmedMeaning).toBeNull();

    h.send({ type: 'SWITCH_NO' });
    await h.until('task.confirming.asking');
    expect(h.task().proposedMeaning).toBe('我想去厕所。'); // checkpoint preserved
  });

  it('switching to the SAME direction is not a switch', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recording.listening');
    h.send({ type: 'SWITCH_REQUESTED', direction: 'ZH_TO_SV' });
    expect(h.is('task.recording.listening')).toBe(true);
  });

  it('works while an API call is in flight; No re-issues the request and ignores the old answer', async () => {
    const mock = createMockProvider();
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const asr: SpeechRecognizer = {
      transcribe: () => (++calls === 1 ? first.promise : second.promise),
    };
    const h = createHarness({ utterances: ['x'], asr, dialogue: mock.dialogue });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.transcribing');
    const firstRequest = h.ctx().activeRequestId;

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    expect(h.is('confirmingSwitch')).toBe(true);
    expect(h.ctx().activeRequestId).toBeNull();
    h.send({ type: 'SWITCH_NO' });
    await h.until('task.transcribing');
    expect(h.ctx().activeRequestId).not.toBe(firstRequest);

    first.resolve('旧的结果'); // the cancelled request answers late
    await new Promise((r) => setTimeout(r, 10));
    expect(h.is('task.transcribing')).toBe(true);
    expect(h.task().dialogueInputs).toHaveLength(0);

    second.resolve('我想去厕所。');
    await h.until('task.confirming.asking');
    expect(h.task().dialogueInputs[0]?.textParts).toEqual(['我想去厕所。']);
  });
});

describe('Stale responses (T09)', () => {
  it('ignores an interpretation that completes after the task was cancelled by a switch', async () => {
    const mock = createMockProvider();
    const slow = deferred<Awaited<ReturnType<DialogueModel['interpretChinese']>>>();
    const dialogue: DialogueModel = {
      interpretChinese: () => slow.promise,
      translate: (i, m) => mock.dialogue.translate(i, m),
    };
    const h = createHarness({ utterances: ['我想去厕所。', 'Hej!'], dialogue });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.interpreting');

    h.send({ type: 'SWITCH_REQUESTED', direction: 'SV_TO_ZH' });
    h.send({ type: 'SWITCH_YES' });
    await h.until('task.recording');
    const newTaskId = h.task().id;

    slow.resolve({ kind: 'PROPOSE_MEANING', meaningZh: '过期的意思。' });
    await new Promise((r) => setTimeout(r, 10));

    expect(h.is('task.recording')).toBe(true);
    expect(h.task().id).toBe(newTaskId);
    expect(h.task().proposedMeaning).toBeNull();
    expect(h.ctx().lastDelivered).toBeNull();
  });

  it('ignores a translation that completes after CANCEL and does not touch memory', async () => {
    const mock = createMockProvider();
    const slow = deferred<string>();
    const dialogue: DialogueModel = {
      interpretChinese: (i, m) => mock.dialogue.interpretChinese(i, m),
      translate: () => slow.promise,
    };
    const h = createHarness({ utterances: ['我想去厕所。'], dialogue });
    await toConfirming(h);
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.translating');

    h.send({ type: 'CANCEL' });
    await h.until('idle');
    slow.resolve('Jag vill gå på toaletten.');
    await new Promise((r) => setTimeout(r, 10));

    expect(h.is('idle')).toBe(true);
    expect(h.ctx().task).toBeNull();
    expect(h.ctx().lastDelivered).toBeNull();
  });

  it('aborts the in-flight request signal when the task is cancelled', async () => {
    let signal: AbortSignal | undefined;
    const asr: SpeechRecognizer = {
      transcribe: (_a, _l, meta) => {
        signal = meta.signal;
        return new Promise<string>(() => undefined);
      },
    };
    const h = createHarness({ utterances: ['x'], asr });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.transcribing');
    await new Promise((r) => setTimeout(r, 5));
    expect(signal?.aborted).toBe(false);
    h.send({ type: 'CANCEL' });
    await h.until('idle');
    expect(signal?.aborted).toBe(true);
  });

  it('every request carries the active taskId and a fresh requestId', async () => {
    const seen: Array<{ taskId: string; requestId: string }> = [];
    const mock = createMockProvider();
    const asr: SpeechRecognizer = {
      transcribe: (a, l, meta) => {
        seen.push({ taskId: meta.taskId, requestId: meta.requestId });
        return mock.asr.transcribe(a, l, meta);
      },
    };
    const h = createHarness({ utterances: ['我想去厕所。', '我想去厕所。'], asr });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');
    h.send({ type: 'CANCEL' });
    await h.until('idle');
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');

    expect(seen).toHaveLength(2);
    expect(seen[0]?.taskId).not.toBe(seen[1]?.taskId);
    expect(seen[0]?.requestId).not.toBe(seen[1]?.requestId);
    expect(seen[1]?.taskId).toBe(h.task().id);
  });
});

describe('unused-import guard', () => {
  it('AppError is exported', () => {
    expect(new AppError('NETWORK').category).toBe('NETWORK');
  });
});
