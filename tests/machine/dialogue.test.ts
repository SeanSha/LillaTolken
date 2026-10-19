import { describe, expect, it, vi } from 'vitest';
import { SimulatedClock } from 'xstate';
import { AppError, LIMITS, type DialogueModel, type InterpretationResult } from '@kt/shared';
import { createMockProvider } from '../../apps/server/src/providers/mock';
import { createHarness, deliverTask, toConfirming } from './harness';

describe('Chinese → Swedish: confirmation is mandatory (T01)', () => {
  it('skips clarification for a clear sentence but STILL asks for confirmation', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await toConfirming(h);

    expect(h.task().clarificationCount).toBe(0);
    expect(h.task().proposedMeaning).toBe('我想去厕所。');
    expect(h.task().translatedText).toBeNull(); // nothing translated before Yes
    expect(h.count('CLARIFICATION_PRESENTED')).toBe(0);
    expect(h.is('task.confirming.asking')).toBe(true);
  });

  it('translates ONLY the confirmed meaning, after explicit Yes', async () => {
    const mock = createMockProvider();
    const translate = vi.spyOn(mock.dialogue, 'translate');
    const h = createHarness({ utterances: ['我想去厕所。'], dialogue: mock.dialogue });
    await toConfirming(h);
    expect(translate).not.toHaveBeenCalled();

    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending');
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0]?.[0]).toMatchObject({ text: '我想去厕所。', direction: 'ZH_TO_SV' });
    expect(h.task().confirmedMeaning).toBe('我想去厕所。');
    expect(h.task().translatedText).toBe('Jag vill gå på toaletten.');
    expect(h.audioStore.getPlayback('result')).not.toBeNull();
  });

  it('does not allow CONFIRM_YES to be skipped by other events', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await toConfirming(h);
    h.send({ type: 'SWITCH_YES' }); // different event must not confirm
    h.send({ type: 'FINISH_INPUT' });
    h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
    expect(h.is('task.confirming.asking')).toBe(true);
    expect(h.task().confirmedMeaning).toBeNull();
  });
});

describe('Segmented recording (T02, T03)', () => {
  it('T02: three fragments → three segments, ONE task, ordered transcript, one translation', async () => {
    const h = createHarness({ utterances: ['老师……', '他把我的……', '水壶拿走了。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    const taskId = h.task().id;

    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.recordSegment();
    expect(h.task().pendingSegments).toBe(3);
    h.send({ type: 'FINISH_INPUT' });
    await h.until('task.confirming.asking');

    expect(h.task().id).toBe(taskId);
    expect(h.count('TASK_STARTED')).toBe(1);
    expect(h.task().segmentInfo).toHaveLength(3);
    expect(h.task().dialogueInputs).toHaveLength(1);
    expect(h.task().dialogueInputs[0]?.textParts).toEqual(['老师……', '他把我的……', '水壶拿走了。']);
    expect(h.task().proposedMeaning).toBe('老师把我的水壶拿走了。');
    // audio of the input is discarded once transcribed
    expect(h.audioStore.getSegments(taskId)).toHaveLength(0);
  });

  it('T03: the 30 s countdown ends only the SEGMENT, then offers Continue / Finished', async () => {
    const clock = new SimulatedClock();
    const h = createHarness({ utterances: ['我想去厕所。'], clock });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recording.listening');

    clock.increment(LIMITS.segmentSeconds * 1000 - 1);
    expect(h.is('task.recording.listening')).toBe(true);
    clock.increment(1);
    await h.until('task.segmentDecision');

    expect(h.count('SEGMENT_TIMEOUT')).toBe(1);
    expect(h.task().pendingSegments).toBe(1);
    expect(h.task().dialogueInputs).toHaveLength(0); // task NOT submitted
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.until('task.recording.listening'); // a fresh 30 s within the same task
  });

  it('silence/pauses do not end a segment on their own', async () => {
    const clock = new SimulatedClock();
    const h = createHarness({ utterances: ['我想去厕所。'], clock });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recording.listening');
    clock.increment(10_000);
    expect(h.is('task.recording.listening')).toBe(true);
  });
});

describe('Clarification policy (T04, T05)', () => {
  it('T04: asks ONE short question for an ambiguous referent, then confirms the clarified meaning', async () => {
    const h = createHarness({ utterances: ['他拿走了我的那个。', '水壶。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.clarifying.asking');

    expect(h.task().clarificationCount).toBe(1);
    expect(h.task().currentQuestion).toContain('那个');
    expect(h.task().proposedMeaning).toBeNull(); // no invented referent
    expect(h.count('CLARIFICATION_PRESENTED')).toBe(1);

    h.send({ type: 'START_ANSWER' });
    expect(h.task().inputPurpose).toBe('CLARIFICATION');
    await h.speak();
    await h.until('task.confirming.asking');

    // the answer is part of the SAME task, tagged with its question
    expect(h.task().dialogueInputs).toHaveLength(2);
    expect(h.task().dialogueInputs[1]).toMatchObject({ purpose: 'CLARIFICATION', textParts: ['水壶。'] });
    expect(h.task().dialogueInputs[1]?.inReplyTo).toContain('那个');
    expect(h.task().proposedMeaning).toBe('他拿走了我的水壶。');
    expect(h.task().clarificationCount).toBe(1);
  });

  it('T05: after three unresolved questions there is NO fourth question (restart/cancel)', async () => {
    const h = createHarness({ utterances: ['他拿走了我的那个。', '嗯……', '不知道。', '那个啦。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    for (let i = 1; i <= 3; i += 1) {
      await h.until('task.clarifying.asking');
      expect(h.task().clarificationCount).toBe(i);
      h.send({ type: 'START_ANSWER' });
      await h.speak();
    }
    await h.until('task.fallback');
    expect(h.count('CLARIFICATION_PRESENTED')).toBe(LIMITS.semanticClarifications);
    expect(h.task().clarificationCount).toBe(3);
    expect(h.ctx().fallbackReason).toBe('UNRESOLVED');
    expect(h.task().translatedText).toBeNull(); // no guessing
  });

  it('the MACHINE enforces the cap even if a misbehaving model keeps asking', async () => {
    const alwaysAsk: DialogueModel = {
      interpretChinese: async () => ({ kind: 'ASK_CLARIFICATION', questionZh: '是什么？', reasonCode: 'X' }),
      translate: async () => 'x',
    };
    const h = createHarness({ utterances: ['a', 'b', 'c', 'd'], dialogue: alwaysAsk });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    for (let i = 0; i < 3; i += 1) {
      await h.until('task.clarifying.asking');
      h.send({ type: 'START_ANSWER' });
      await h.speak();
    }
    await h.until('task.fallback');
    expect(h.ctx().fallbackReason).toBe('CLARIFICATION_LIMIT');
    expect(h.task().clarificationCount).toBe(3);
    expect(h.count('CLARIFICATION_PRESENTED')).toBe(3);
  });

  it('audio segments, ASR retries and final confirmation do NOT consume the clarification budget', async () => {
    const h = createHarness({ utterances: ['[EMPTY]', '我想去', '厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.asrEmpty');
    h.send({ type: 'RETRY' });
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.recordSegment();
    h.send({ type: 'FINISH_INPUT' });
    await h.until('task.confirming.asking');
    expect(h.task().clarificationCount).toBe(0);
  });
});

describe('Confirmation No (T06)', () => {
  it('rejected meaning becomes invalid and a correction is collected; Yes then translates the NEW meaning', async () => {
    const h = createHarness({ utterances: ['我想喝水。', '我想吃苹果。'] });
    await toConfirming(h);
    expect(h.task().proposedMeaning).toBe('我想喝水。');

    h.send({ type: 'CONFIRM_NO' });
    expect(h.task().proposedMeaning).toBeNull();
    expect(h.task().correctionCount).toBe(1);
    expect(h.task().inputPurpose).toBe('CORRECTION');
    expect(h.count('CONFIRMATION_NO')).toBe(1);

    await h.speak();
    await h.until('task.confirming.asking');
    expect(h.task().proposedMeaning).toBe('我想吃苹果。');
    expect(h.task().dialogueInputs.map((d) => d.purpose)).toEqual(['INITIAL', 'CORRECTION']);

    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending');
    expect(h.task().translatedText).toBe('Jag vill äta ett äpple.');
  });

  it('allows at most two correction attempts, then restart/cancel', async () => {
    const h = createHarness({ utterances: ['我想喝水。', '我想吃苹果。', '我想吃香蕉。'] });
    await toConfirming(h);
    h.send({ type: 'CONFIRM_NO' });
    await h.speak();
    await h.until('task.confirming.asking');
    h.send({ type: 'CONFIRM_NO' });
    await h.speak();
    await h.until('task.confirming.asking');
    expect(h.task().correctionCount).toBe(LIMITS.correctionAttempts);

    h.send({ type: 'CONFIRM_NO' }); // third rejection
    await h.until('task.fallback');
    expect(h.ctx().fallbackReason).toBe('CORRECTION_LIMIT');
    expect(h.task().translatedText).toBeNull();
  });
});

describe('Swedish → Chinese direct path (T07)', () => {
  it('transcribes, translates directly (no meaning confirmation) and shows original + translation', async () => {
    const mock = createMockProvider();
    const interpret = vi.spyOn(mock.dialogue, 'interpretChinese');
    const h = createHarness({ utterances: ['Lägg boken på bordet.'], dialogue: mock.dialogue });
    h.send({ type: 'START_TASK', direction: 'SV_TO_ZH' });
    await h.speak();
    await h.until('task.result.pending');

    expect(interpret).not.toHaveBeenCalled();
    expect(h.count('CONFIRMATION_YES') + h.count('CLARIFICATION_PRESENTED')).toBe(0);
    expect(h.task().sourceText).toBe('Lägg boken på bordet.');
    expect(h.task().translatedText).toBe('把书放在桌子上。');
    expect(h.audioStore.getPlayback('result')?.mimeType).toBe('audio/wav'); // Chinese speech ready
  });
});

describe('Session memory (T10, memory lifecycle)', () => {
  it('a translation is NOT remembered until delivery completes', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await toConfirming(h);
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending');
    expect(h.task().translatedText).not.toBeNull();
    expect(h.ctx().lastDelivered).toBeNull();

    h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
    await h.until('task.result.delivered');
    expect(h.ctx().lastDelivered).toEqual({
      taskId: h.task().id,
      direction: 'ZH_TO_SV',
      source: '我想去厕所。',
      translation: 'Jag vill gå på toaletten.',
    });
    expect(h.count('PLAYBACK_COMPLETED')).toBe(1);
    expect(h.count('TASK_COMPLETED')).toBe(1);
  });

  it('text-only delivery cannot be claimed while audio is still pending', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await toConfirming(h);
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending');
    h.send({ type: 'DELIVERY_FINISHED', mode: 'text_only' });
    expect(h.is('task.result.pending')).toBe(true);
    expect(h.ctx().lastDelivered).toBeNull();
  });

  it('T10: a successful task followed by a cancelled task retains only the last DELIVERED message', async () => {
    const h = createHarness({ utterances: ['我想去厕所。', '我想喝水。'] });
    await deliverTask(h);
    const first = h.ctx().lastDelivered;
    expect(first?.source).toBe('我想去厕所。');

    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending'); // translated but never delivered
    h.send({ type: 'CANCEL' });
    await h.until('idle');

    expect(h.ctx().lastDelivered).toEqual(first);
    expect(h.count('TASK_CANCELLED')).toBe(1);
  });

  it('passes ONLY the previous delivered message (across directions) to the model as optional context', async () => {
    const mock = createMockProvider();
    const interpret = vi.spyOn(mock.dialogue, 'interpretChinese');
    const h = createHarness({ utterances: ['Hej!', '我想去厕所。'], dialogue: mock.dialogue });
    h.send({ type: 'START_TASK', direction: 'SV_TO_ZH' });
    await h.speak();
    await h.until('task.result.pending');
    h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
    await h.until('task.result.delivered');

    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');
    const arg = interpret.mock.calls[0]?.[0];
    expect(arg?.previousDelivered).toMatchObject({ direction: 'SV_TO_ZH', source: 'Hej!', translation: '你好！' });
  });

  it('T12: END_SESSION clears memory, task and volatile audio; metadata events remain', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await deliverTask(h);
    expect(h.ctx().lastDelivered).not.toBeNull();
    const oldSession = h.ctx().sessionId;

    h.send({ type: 'END_SESSION' });
    await h.until('idle');
    expect(h.ctx().lastDelivered).toBeNull();
    expect(h.ctx().task).toBeNull();
    expect(h.ctx().sessionId).not.toBe(oldSession);
    expect(h.audioStore.stats()).toEqual({ segmentTasks: 0, playbackSlots: 0 });
    expect(h.count('SESSION_ENDED')).toBe(1);
  });

  it('T12: evaluation events never contain conversation content', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await deliverTask(h);
    const dump = JSON.stringify(h.logs);
    for (const secret of ['厕所', 'Jag vill', 'toaletten', '你是说']) {
      expect(dump).not.toContain(secret);
    }
    // and not in the (persistable) machine snapshot as raw audio either
    expect(JSON.stringify(h.actor.getPersistedSnapshot())).not.toContain('mimeType');
  });
});

describe('Provider presets (T13)', () => {
  it('can change the preset only while idle; a running task keeps its frozen preset', async () => {
    const mock = createMockProvider();
    const cloudLike = createMockProvider();
    const cloudAsr = vi.spyOn(cloudLike.asr, 'transcribe');
    const mockAsr = vi.spyOn(mock.asr, 'transcribe');
    const h = createHarness({ utterances: ['我想去厕所。'], bundles: { mock, cloud: cloudLike } });

    h.send({ type: 'SET_PRESET', preset: 'cloud' });
    expect(h.ctx().preset).toBe('cloud');
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    expect(h.task().preset).toBe('cloud');

    h.send({ type: 'SET_PRESET', preset: 'mock' }); // mid-task: ignored
    expect(h.ctx().preset).toBe('cloud');
    expect(h.task().preset).toBe('cloud');

    await h.speak();
    await h.until('task.confirming.asking');
    expect(cloudAsr).toHaveBeenCalledTimes(1);
    expect(mockAsr).not.toHaveBeenCalled();

    h.send({ type: 'CANCEL' });
    await h.until('idle');
    h.send({ type: 'SET_PRESET', preset: 'mock' });
    expect(h.ctx().preset).toBe('mock');
  });
});

describe('Interpretation validation', () => {
  it('rejects malformed model structures before they reach the machine', async () => {
    const bad: DialogueModel = {
      interpretChinese: async () => ({ kind: 'PROPOSE_MEANING', meaningZh: '   ' }) as InterpretationResult,
      translate: async () => 'x',
    };
    const h = createHarness({ utterances: ['我想去厕所。'], dialogue: bad });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.recoverableError');
    expect(h.ctx().error).toEqual({ stage: 'interpret', category: 'INVALID_MODEL_OUTPUT' });
    expect(h.task().proposedMeaning).toBeNull();
  });

  it('ignores a model that returns a non-error AppError kind it does not know', async () => {
    const weird: DialogueModel = {
      interpretChinese: () => Promise.reject(new AppError('SERVER')),
      translate: async () => 'x',
    };
    const h = createHarness({ utterances: ['我想去厕所。'], dialogue: weird });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.recoverableError');
    expect(h.ctx().error?.category).toBe('SERVER');
  });
});
