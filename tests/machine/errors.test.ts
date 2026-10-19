import { describe, expect, it } from 'vitest';
import { AppError, LIMITS, type AudioData, type SpeechSynthesizer } from '@kt/shared';
import { createMockProvider } from '../../apps/server/src/providers/mock';
import type { Recorder } from '../../apps/web/src/dialogue/types';
import { ScriptedRecorder } from '../../apps/web/src/audio/recorder';
import { createHarness, deliverTask, ListSource, toConfirming } from './harness';

describe('Error handling & recovery (T11)', () => {
  it('empty ASR → asks to re-record; a second attempt succeeds; counts retries', async () => {
    const h = createHarness({ utterances: ['[EMPTY]', '我想去厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.asrEmpty');
    expect(h.task().asrRetryCount).toBe(1);
    expect(h.audioStore.getSegments(h.task().id)).toHaveLength(0); // empty audio discarded

    h.send({ type: 'RETRY' });
    await h.speak();
    await h.until('task.confirming.asking');
    expect(h.task().proposedMeaning).toBe('我想去厕所。');
  });

  it(`empty ASR beyond ${LIMITS.asrRetries} retries → restart/cancel, never a guess`, async () => {
    const h = createHarness({ utterances: ['[EMPTY]', '[EMPTY]', '[EMPTY]'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    for (let i = 0; i < LIMITS.asrRetries; i += 1) {
      await h.speak();
      await h.until('task.asrEmpty');
      h.send({ type: 'RETRY' });
    }
    await h.speak();
    await h.until('task.fallback');
    expect(h.ctx().fallbackReason).toBe('ASR_EMPTY_LIMIT');
    expect(h.ctx().lastDelivered).toBeNull();
  });

  it('network error during ASR → recoverable; RETRY reuses the retained audio and succeeds', async () => {
    const h = createHarness({ utterances: ['[NETWORK_ERROR]我想去厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.recoverableError');
    expect(h.ctx().error).toEqual({ stage: 'asr', category: 'NETWORK' });
    expect(h.audioStore.getSegments(h.task().id)).toHaveLength(1); // audio kept for the retry

    h.send({ type: 'RETRY' });
    await h.until('task.confirming.asking');
    expect(h.ctx().error).toBeNull();
    expect(h.task().proposedMeaning).toBe('我想去厕所。');
  });

  it('malformed model JSON → recoverable; RETRY succeeds', async () => {
    const h = createHarness({ utterances: ['[MALFORMED]我想去厕所。'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.recoverableError');
    expect(h.ctx().error).toEqual({ stage: 'interpret', category: 'INVALID_MODEL_OUTPUT' });
    h.send({ type: 'RETRY' });
    await h.until('task.confirming.asking');
  });

  it('translation failure → recoverable; nothing delivered, memory untouched; CANCEL leaves cleanly', async () => {
    const mock = createMockProvider();
    const h = createHarness({
      utterances: ['我想去厕所。'],
      dialogue: {
        interpretChinese: (i, m) => mock.dialogue.interpretChinese(i, m),
        translate: () => Promise.reject(new AppError('TIMEOUT')),
      },
    });
    await toConfirming(h);
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.recoverableError');
    expect(h.ctx().error).toEqual({ stage: 'translate', category: 'TIMEOUT' });
    expect(h.ctx().lastDelivered).toBeNull();
    h.send({ type: 'CANCEL' });
    await h.until('idle');
    expect(h.ctx().lastDelivered).toBeNull();
    expect(h.eventTypes()).not.toContain('TASK_COMPLETED');
  });

  it('microphone permission denied → recoverable error, no false success; RETRY after granting works', async () => {
    let deny = true;
    const inner = new ScriptedRecorder(new ListSource(['我想去厕所。']));
    const recorder: Recorder = {
      start: async () => {
        if (deny) throw new AppError('PERMISSION_DENIED');
        await inner.start();
      },
      stop: () => inner.stop(),
      cancel: () => inner.cancel(),
    };
    const h = createHarness({ recorder });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recoverableError');
    expect(h.ctx().error).toEqual({ stage: 'recorder', category: 'PERMISSION_DENIED' });
    expect(h.task().dialogueInputs).toHaveLength(0);

    deny = false;
    h.send({ type: 'RETRY' });
    await h.speak();
    await h.until('task.confirming.asking');
  });

  it('a recorder that yields no audio is reported, not treated as speech', async () => {
    const recorder: Recorder = {
      start: async () => undefined,
      stop: () => Promise.reject(new AppError('RECORDER')),
      cancel: () => undefined,
    };
    const h = createHarness({ recorder });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.until('task.recording.listening');
    h.send({ type: 'STOP_SEGMENT' });
    await h.until('task.recoverableError');
    expect(h.ctx().error?.stage).toBe('recorder');
    h.send({ type: 'CANCEL' });
    await h.until('idle');
  });

  describe('TTS failure', () => {
    const failingTts: SpeechSynthesizer = { synthesize: () => Promise.reject(new AppError('TTS')) };

    it('result TTS failure keeps readable text; no memory until the adult accepts text-only', async () => {
      const h = createHarness({ utterances: ['我想去厕所。'], tts: failingTts });
      await toConfirming(h); // prompt TTS also fails: non-fatal
      expect(h.ctx().audioStatus).toBe('failed');
      h.send({ type: 'CONFIRM_YES' });
      await h.until('task.result.ttsFailed');

      expect(h.task().translatedText).toBe('Jag vill gå på toaletten.');
      expect(h.ctx().lastDelivered).toBeNull();
      h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' }); // cannot claim audio delivery
      expect(h.is('task.result.ttsFailed')).toBe(true);

      h.send({ type: 'DELIVERY_FINISHED', mode: 'text_only' });
      await h.until('task.result.delivered');
      expect(h.ctx().lastDelivered?.translation).toBe('Jag vill gå på toaletten.');
      expect(h.logs.find((l) => l.eventType === 'TASK_COMPLETED')?.deliveryMode).toBe('text_only');
      expect(h.count('PLAYBACK_COMPLETED')).toBe(0);
    });

    it('manual replay (RETRY) re-synthesizes; success returns to audio delivery', async () => {
      const mock = createMockProvider();
      let fail = true;
      const flaky: SpeechSynthesizer = {
        synthesize: (t, l, m) => (fail ? Promise.reject(new AppError('TTS')) : mock.tts.synthesize(t, l, m)),
      };
      const h = createHarness({ utterances: ['我想去厕所。'], tts: flaky });
      fail = false;
      await toConfirming(h);
      h.send({ type: 'CONFIRM_YES' });
      fail = true;
      await h.until('task.result.ttsFailed');
      fail = false;
      h.send({ type: 'RETRY' });
      await h.until('task.result.pending');
      expect(h.audioStore.getPlayback('result')).not.toBeNull();
      h.send({ type: 'DELIVERY_FINISHED', mode: 'audio' });
      await h.until('task.result.delivered');
      expect(h.ctx().lastDelivered).not.toBeNull();
    });

    it('a failed spoken question stays usable (text shown) and can be retried', async () => {
      const mock = createMockProvider();
      let fail = true;
      const flaky: SpeechSynthesizer = {
        synthesize: (t, l, m) => (fail ? Promise.reject(new AppError('TTS')) : mock.tts.synthesize(t, l, m)),
      };
      const h = createHarness({ utterances: ['他拿走了我的那个。'], tts: flaky });
      h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
      await h.speak();
      await h.until('task.clarifying.asking');
      expect(h.ctx().audioStatus).toBe('failed');
      expect(h.task().currentQuestion).not.toBeNull();
      expect(h.audioStore.getPlayback('prompt')).toBeNull();
      fail = false;
      h.send({ type: 'RETRY' });
      await h.until('task.clarifying.asking');
      await new Promise((r) => setTimeout(r, 5));
      expect(h.ctx().audioStatus).toBe('ready');
      expect(h.audioStore.getPlayback('prompt')).not.toBeNull();
      expect(h.task().clarificationCount).toBe(1); // retrying audio does not consume budget
    });
  });

  it('cancelling at any point leaves no volatile audio behind', async () => {
    const h = createHarness({ utterances: ['老师……', '他把我的……'] });
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    await h.recordSegment();
    expect(h.audioStore.getSegments(h.task().id)).toHaveLength(2);
    h.send({ type: 'CANCEL' });
    await h.until('idle');
    expect(h.audioStore.stats()).toEqual({ segmentTasks: 0, playbackSlots: 0 });
  });

  it('delivered task keeps result audio only until a new turn begins', async () => {
    const h = createHarness({ utterances: ['我想去厕所。'] });
    await deliverTask(h);
    expect(h.audioStore.getPlayback('result')).not.toBeNull(); // replay still possible
    h.send({ type: 'NEW_TURN' });
    await h.until('idle');
    expect(h.audioStore.stats()).toEqual({ segmentTasks: 0, playbackSlots: 0 });
    expect(h.count('TASK_CANCELLED')).toBe(0); // completing a task is not a cancellation
  });

  it('exports compile-time shape for AudioData in tests', () => {
    const a: AudioData = { bytes: new Uint8Array(1), mimeType: 'audio/mp4' };
    expect(a.mimeType).toBe('audio/mp4');
  });
});
