import { describe, expect, it } from 'vitest';
import { AppError, type SpeechSynthesizer } from '@kt/shared';
import { ResponseLatencyTracker } from '../../apps/web/src/dialogue/responseLatency';
import { createMockProvider } from '../../apps/server/src/providers/mock';
import { createHarness } from './harness';

function tracked(utterances: string[], extra: Parameters<typeof createHarness>[0] = {}) {
  let now = 0;
  const tracker = new ResponseLatencyTracker();
  const h = createHarness({ ...extra, utterances, responses: tracker, monoNow: () => now });
  return { h, tracker, at: (t: number) => { now = t; } };
}

describe('dialogue machine arms response latency without changing the spoken result', () => {
  it('pairs confirmation audio with FINISH_INPUT, not with TTS completion', async () => {
    const { h, tracker, at } = tracked(['我想去厕所。']);
    at(1_000);
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    expect(tracker.peek()).toBeNull(); // the start prompt is not a system response
    await h.speak();
    at(2_500); // time passes while ASR / interpretation / TTS run
    await h.until('task.confirming.asking');
    expect(h.count('TTS_READY')).toBeGreaterThan(0);
    expect(h.count('PLAYBACK_STARTED')).toBe(0);
    expect(tracker.peek()?.counted).toBe(false);

    at(6_000);
    const sample = tracker.noteAudibleStart(6_000);
    expect(sample).toMatchObject({ responseType: 'confirmation', responseTrigger: 'audio_input', responseLatencyMs: 5_000 });
    const tts = h.logs.filter((l) => l.eventType === 'TTS_READY').at(-1)?.stageDurationMs;
    expect(sample?.responseLatencyMs).not.toBe(tts);
    expect(tracker.noteAudibleStart(7_000)).toBeNull();
  });

  it('keeps a separate latency for each clarification round', async () => {
    const { h, tracker, at } = tracked(['他拿走了我的那个。', '嗯', '水壶。']);
    at(1_000);
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.clarifying.asking');
    at(4_000);
    expect(tracker.noteAudibleStart(4_000)).toMatchObject({ responseType: 'clarification', responseLatencyMs: 3_000 });

    at(8_000);
    h.send({ type: 'START_ANSWER' });
    await h.speak();
    await h.until('task.clarifying.asking');
    at(9_500);
    expect(tracker.noteAudibleStart(9_500)).toMatchObject({ responseType: 'clarification', responseTrigger: 'audio_input', responseLatencyMs: 1_500 });
    expect(h.task().clarificationCount).toBe(2);
  });

  it('times the final translation from the Yes tap', async () => {
    const { h, tracker, at } = tracked(['我想去厕所。']);
    at(1_000);
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');
    at(2_000);
    tracker.noteAudibleStart(2_000);

    at(5_000);
    h.send({ type: 'CONFIRM_YES' });
    await h.until('task.result.pending');
    at(9_000);
    expect(tracker.noteAudibleStart(9_000)).toMatchObject({
      responseType: 'translation',
      responseTrigger: 'confirmation_tap',
      responseLatencyMs: 4_000,
    });
    expect(h.task().translatedText).toBe('Jag vill gå på toaletten.');
  });

  it('uses one input-finished time after several recording segments', async () => {
    const { h, tracker, at } = tracked(['老师……', '他把我的……', '水壶拿走了。']);
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    at(100);
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    at(400);
    await h.recordSegment();
    h.send({ type: 'CONTINUE_SPEAKING' });
    at(9_000);
    await h.recordSegment();
    h.send({ type: 'FINISH_INPUT' });
    await h.until('task.confirming.asking');
    at(12_000);
    expect(tracker.noteAudibleStart(12_000)?.responseLatencyMs).toBe(3_000);
  });

  it('a Swedish turn is an audio-input translation, with no confirmation tap', async () => {
    const { h, tracker, at } = tracked(['Lägg boken på bordet.']);
    at(500);
    h.send({ type: 'START_TASK', direction: 'SV_TO_ZH' });
    await h.speak();
    await h.until('task.result.pending');
    expect(h.count('CONFIRMATION_YES')).toBe(0);
    at(2_000);
    expect(tracker.noteAudibleStart(2_000)).toMatchObject({ responseType: 'translation', responseTrigger: 'audio_input', responseLatencyMs: 1_500 });
  });

  it('cancellation and text-only delivery do not invent a latency', async () => {
    const cancelled = tracked(['我想去厕所。']);
    cancelled.at(1_000);
    cancelled.h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await cancelled.h.speak();
    await cancelled.h.until('task.confirming.asking');
    cancelled.h.send({ type: 'CANCEL' });
    await cancelled.h.until('idle');
    expect(cancelled.tracker.noteAudibleStart(9_000)).toBeNull();

    const failing: SpeechSynthesizer = { synthesize: () => Promise.reject(new AppError('TTS')) };
    const textOnly = tracked(['我想去厕所。'], { tts: failing });
    textOnly.at(1_000);
    textOnly.h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await textOnly.h.speak();
    await textOnly.h.until('task.confirming.asking');
    textOnly.at(3_000);
    textOnly.h.send({ type: 'CONFIRM_YES' });
    await textOnly.h.until('task.result.ttsFailed');
    textOnly.h.send({ type: 'DELIVERY_FINISHED', mode: 'text_only' });
    await textOnly.h.until('task.result.delivered');
    expect(textOnly.tracker.noteAudibleStart(8_000)).toBeNull();
    expect(textOnly.h.count('PLAYBACK_COMPLETED')).toBe(0);
  });

  it('a TTS retry before the first audible start keeps the original trigger', async () => {
    const mock = createMockProvider();
    let fail = false;
    const flaky: SpeechSynthesizer = {
      synthesize: (text, language, meta) => (fail ? Promise.reject(new AppError('TTS')) : mock.tts.synthesize(text, language, meta)),
    };
    const { h, tracker, at } = tracked(['我想去厕所。'], { tts: flaky });
    at(1_000);
    h.send({ type: 'START_TASK', direction: 'ZH_TO_SV' });
    await h.speak();
    await h.until('task.confirming.asking');
    at(2_000);
    tracker.noteAudibleStart(2_000);
    at(4_000);
    h.send({ type: 'CONFIRM_YES' });
    fail = true;
    await h.until('task.result.ttsFailed');
    fail = false;
    h.send({ type: 'RETRY' });
    await h.until('task.result.pending');
    at(9_000);
    expect(tracker.noteAudibleStart(9_000)).toMatchObject({ responseTrigger: 'confirmation_tap', responseLatencyMs: 5_000 });
    expect(h.logs.filter((l) => l.eventType === 'TTS_READY').length).toBeGreaterThan(1);
  });
});
