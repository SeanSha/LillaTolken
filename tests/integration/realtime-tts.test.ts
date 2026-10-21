import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import type { RealtimeClientEvent, RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { loadConfig } from '../../apps/server/src/config';
import { OpenAISpeechSynthesizer } from '../../apps/server/src/providers/cloud';
import { pcm16ToWav, transcriptMatchesText, type RealtimeTtsSocket } from '../../apps/server/src/providers/cloud/realtimeTts';
import { wavDurationMs } from '../../apps/server/src/media/duration';

const cfg = loadConfig({ OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv).openai;

class FakeSocket implements RealtimeTtsSocket {
  sent: RealtimeClientEvent[] = [];
  closed = false;
  private listeners: Array<(event: RealtimeServerEvent) => void> = [];
  private pcm = new Uint8Array(480);
  transcript = '我想去厕所。';
  status: 'completed' | 'failed' = 'completed';

  on(event: 'event' | 'error', listener: (event: RealtimeServerEvent) => void): void {
    if (event === 'event') this.listeners.push(listener);
  }

  send(event: RealtimeClientEvent): void {
    this.sent.push(event);
    if (event.type === 'session.update') {
      queueMicrotask(() => this.emit({ type: 'session.updated', event_id: 'e1', session: {} as never }));
    }
    if (event.type === 'response.create') {
      queueMicrotask(() => {
        this.emit({ type: 'response.output_audio.delta', delta: Buffer.from(this.pcm).toString('base64'), event_id: 'e2', content_index: 0, item_id: 'i', output_index: 0, response_id: 'r' });
        this.emit({ type: 'response.output_audio_transcript.delta', delta: this.transcript, event_id: 'e3', content_index: 0, item_id: 'i', output_index: 0, response_id: 'r' });
        this.emit({
          type: 'response.done',
          event_id: 'e4',
          response: {
            status: this.status,
            usage: {
              input_tokens: 12,
              output_tokens: 8,
              input_token_details: { text_tokens: 12, audio_tokens: 0, image_tokens: 0, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } },
              output_token_details: { text_tokens: 3, audio_tokens: 5 },
            },
          },
        });
      });
    }
  }

  close(): void {
    this.closed = true;
  }

  private emit(event: RealtimeServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

describe('Realtime TTS adapter', () => {
  it('defaults to gpt-realtime-2.1-mini and still accepts the Speech API model', () => {
    expect(cfg.ttsModel).toBe('gpt-realtime-2.1-mini');
    expect(loadConfig({ OPENAI_TTS_MODEL: 'gpt-4o-mini-tts' } as NodeJS.ProcessEnv).openai.ttsModel).toBe('gpt-4o-mini-tts');
  });

  it('speaks only the supplied text as 24 kHz WAV and reports split token usage', async () => {
    const socket = new FakeSocket();
    const reported: Array<Record<string, unknown>> = [];
    const audio = await new OpenAISpeechSynthesizer({} as OpenAI, cfg, async () => socket).synthesize('我想去厕所。', 'zh', {
      taskId: 't',
      requestId: 'r',
      report: (usage) => reported.push(usage),
    });
    expect(audio.mimeType).toBe('audio/wav');
    expect(wavDurationMs(audio.bytes)).toBe(10);
    expect(socket.closed).toBe(true);
    const session = socket.sent.find((event) => event.type === 'session.update');
    expect(session && session.type === 'session.update' && session.session.type === 'realtime' ? session.session : undefined).toMatchObject({
      model: 'gpt-realtime-2.1-mini',
      output_modalities: ['audio'],
      tools: [],
      audio: { input: { turn_detection: null }, output: { voice: 'alloy', speed: 1, format: { type: 'audio/pcm', rate: 24000 } } },
    });
    const response = socket.sent.find((event) => event.type === 'response.create');
    expect(response && response.type === 'response.create' ? response.response : undefined).toMatchObject({
      conversation: 'none',
      output_modalities: ['audio'],
      input: [{ role: 'user', content: [{ type: 'input_text', text: '我想去厕所。' }] }],
    });
    const instructions = session && session.type === 'session.update' && session.session.type === 'realtime' ? session.session.instructions : '';
    expect(instructions).toContain('Speak Mandarin Chinese slowly');
    expect(instructions).toContain('我想去厕所。');
    expect(instructions).toContain('Do not translate');
    expect(reported[0]).toMatchObject({
      promptTokens: 12,
      outputTokens: 8,
      inputTextTokens: 12,
      inputAudioTokens: 0,
      outputTextTokens: 3,
      outputAudioTokens: 5,
      resolvedModel: 'gpt-realtime-2.1-mini',
      resolvedVoice: 'alloy',
      outputAudioMs: 10,
    });
  });

  it('rejects audio whose transcript is not the supplied text', async () => {
    const socket = new FakeSocket();
    socket.transcript = '好的，我想去厕所。';
    await expect(
      new OpenAISpeechSynthesizer({} as OpenAI, cfg, async () => socket).synthesize('我想去厕所。', 'zh', { taskId: 't', requestId: 'r' }),
    ).rejects.toMatchObject({ category: 'TTS' });
    expect(socket.closed).toBe(true);
  });

  it('pcm16ToWav is mono 16-bit 24 kHz and transcript matching ignores punctuation', () => {
    const wav = pcm16ToWav(new Uint8Array(48_000));
    expect(wavDurationMs(wav)).toBe(1000);
    expect(transcriptMatchesText('Jag vill gå på toaletten.', 'jag vill gå på toaletten')).toBe(true);
    expect(transcriptMatchesText('Hej', 'Hej då')).toBe(false);
  });
});
