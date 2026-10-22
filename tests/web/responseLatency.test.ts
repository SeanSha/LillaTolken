import { describe, expect, it } from 'vitest';
import { ResponseLatencyTracker } from '../../apps/web/src/dialogue/responseLatency';

describe('response latency pairing', () => {
  it('measures a normal response from input completion to the first audible start', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('confirmation');
    expect(t.noteAudibleStart(5_000)).toMatchObject({
      responseType: 'confirmation',
      responseTrigger: 'audio_input',
      responseLatencyMs: 4_000,
    });
  });

  it('pairs each clarification with its own input, not the first one', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('clarification');
    expect(t.noteAudibleStart(4_000)?.responseLatencyMs).toBe(3_000);

    t.noteInputFinished(8_000);
    t.arm('clarification');
    const second = t.noteAudibleStart(10_500);
    expect(second).toMatchObject({ responseType: 'clarification', responseTrigger: 'audio_input', responseLatencyMs: 2_500 });
    expect(second?.responseLatencyMs).not.toBe(10_500 - 1_000);
  });

  it('times the translation from the confirmation tap, and the confirmation from the speech', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('confirmation');
    expect(t.noteAudibleStart(3_000)).toMatchObject({ responseType: 'confirmation', responseTrigger: 'audio_input', responseLatencyMs: 2_000 });

    t.noteConfirmationTap(7_000);
    t.arm('translation');
    expect(t.noteAudibleStart(11_000)).toMatchObject({
      responseType: 'translation',
      responseTrigger: 'confirmation_tap',
      responseLatencyMs: 4_000,
    });
  });

  it('does not record a latency when playback never starts, and a later success still uses the original trigger', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('translation');
    expect(t.peek()?.counted).toBe(false);
    t.arm('translation'); // TTS retry before any audio
    expect(t.noteAudibleStart(6_000)).toMatchObject({ responseLatencyMs: 5_000, responseTrigger: 'audio_input' });
  });

  it('counts the first audible start once when the same clip plays again', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(100);
    t.arm('translation');
    expect(t.noteAudibleStart(400)?.responseLatencyMs).toBe(300);
    expect(t.noteAudibleStart(900)).toBeNull();
    expect(t.noteAudibleStart(1_200)).toBeNull();
  });

  it('drops an unplayed translation on text-only delivery instead of storing zero', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('translation');
    t.abandonUnplayed();
    expect(t.noteAudibleStart(5_000)).toBeNull();
    expect(t.peek()).toBeNull();
  });

  it('leaves latency unset when the trigger is missing, and ignores a start with nothing armed', () => {
    const t = new ResponseLatencyTracker();
    expect(t.noteAudibleStart(50)).toBeNull();
    t.arm('clarification');
    const sample = t.noteAudibleStart(80);
    expect(sample?.responseType).toBe('clarification');
    expect(sample?.responseLatencyMs).toBeUndefined();
    expect(sample?.responseTrigger).toBeUndefined();
  });

  it('a cancelled task cannot be paired with a later playback', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(1_000);
    t.arm('confirmation');
    t.reset();
    expect(t.noteAudibleStart(4_000)).toBeNull();
  });

  it('a direct translation uses the speech trigger, not a confirmation tap', () => {
    const t = new ResponseLatencyTracker();
    t.noteInputFinished(2_000);
    t.arm('translation');
    expect(t.noteAudibleStart(2_750)).toMatchObject({ responseType: 'translation', responseTrigger: 'audio_input', responseLatencyMs: 750 });
  });
});
