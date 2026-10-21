// Text-in, audio-out TTS on the Realtime API. One socket per utterance, then it closes.
// No microphone, no turn detection, and no tools: this is not a voice conversation.
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import type OpenAI from 'openai';
import type { RealtimeClientEvent, RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { AppError, type AudioData, type Language, type NormalizedUsage } from '@kt/shared';
import { wavDurationMs } from '../../media/duration';
import { TTS_INSTRUCTIONS, TTS_READ_EXACTLY } from './prompts';

const PCM_RATE = 24_000;

export function usesRealtimeTts(model: string): boolean {
  return model.startsWith('gpt-realtime');
}

/** Compare spoken text without punctuation or spacing. Content stays on the server. */
export function transcriptMatchesText(source: string, transcript: string): boolean {
  const norm = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, '');
  const expected = norm(source);
  return expected.length > 0 && expected === norm(transcript);
}

export function pcm16ToWav(pcm: Uint8Array, sampleRate = PCM_RATE): Uint8Array {
  const samples = pcm.length % 2 === 0 ? pcm : pcm.subarray(0, pcm.length - 1);
  const bytes = new Uint8Array(44 + samples.length);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length, true);
  bytes.set(samples, 44);
  return bytes;
}

export type RealtimeTtsSocket = {
  send(event: RealtimeClientEvent): void;
  close(): void;
  on(event: 'event', listener: (event: RealtimeServerEvent) => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  socket?: { readyState: number; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
};

export type RealtimeTtsConnect = (client: OpenAI, model: string) => Promise<RealtimeTtsSocket>;

export async function connectRealtimeTts(client: OpenAI, model: string): Promise<RealtimeTtsSocket> {
  return OpenAIRealtimeWebSocket.create(client, { model });
}

function speakInstructions(language: Language, text: string): string {
  return `${TTS_READ_EXACTLY}\n${TTS_INSTRUCTIONS[language]}\nSpeak this text and nothing else:\n${text}`;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function transcriptOf(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const message = item as { type?: string; role?: string; content?: Array<{ transcript?: string; text?: string }> };
    if (message.type !== 'message' || message.role !== 'assistant') continue;
    for (const part of message.content ?? []) {
      if (part.transcript) parts.push(part.transcript);
      else if (part.text) parts.push(part.text);
    }
  }
  return parts.join('');
}

type UsageResponse = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: {
      text_tokens?: number;
      audio_tokens?: number;
      image_tokens?: number;
      cached_tokens?: number;
      cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
    };
    output_token_details?: { text_tokens?: number; audio_tokens?: number };
  };
};

export function usageFromRealtime(response: UsageResponse, model: string, voice: string): NormalizedUsage {
  const usage = response.usage;
  const input = usage?.input_token_details;
  const output = usage?.output_token_details;
  const reported: NormalizedUsage = { resolvedModel: model, resolvedVoice: voice };
  if (usage?.input_tokens !== undefined) reported.promptTokens = usage.input_tokens;
  if (usage?.output_tokens !== undefined) reported.outputTokens = usage.output_tokens;
  if (input?.cached_tokens !== undefined) reported.cachedPromptTokens = input.cached_tokens;
  if (
    input?.text_tokens === undefined ||
    input.audio_tokens === undefined ||
    output?.text_tokens === undefined ||
    output.audio_tokens === undefined
  ) {
    return reported;
  }
  const cachedText = input.cached_tokens_details?.text_tokens;
  const cachedAudio = input.cached_tokens_details?.audio_tokens;
  reported.inputTextTokens = input.text_tokens;
  reported.inputAudioTokens = input.audio_tokens;
  reported.inputImageTokens = input.image_tokens ?? 0;
  reported.outputTextTokens = output.text_tokens;
  reported.outputAudioTokens = output.audio_tokens;
  reported.cachedAudioTokens = cachedAudio ?? 0;
  if (cachedText !== undefined) reported.cachedTextTokens = cachedText;
  else if ((input.cached_tokens ?? 0) === 0 || input.audio_tokens === 0) reported.cachedTextTokens = input.cached_tokens ?? 0;
  return reported;
}

export async function synthesizeRealtimeTts(options: {
  client: OpenAI;
  model: string;
  voice: string;
  language: Language;
  text: string;
  timeoutMs: number;
  signal?: AbortSignal;
  connect?: RealtimeTtsConnect;
  onUsage?: (usage: NormalizedUsage) => void;
}): Promise<AudioData> {
  const connect = options.connect ?? connectRealtimeTts;
  const socket = await connect(options.client, options.model);
  const chunks: Uint8Array[] = [];
  let streamedTranscript = '';
  let settled = false;
  const instructions = speakInstructions(options.language, options.text);

  const work = new Promise<AudioData>((resolve, reject) => {
    const fail = (error: AppError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (audio: AudioData) => {
      if (settled) return;
      settled = true;
      resolve(audio);
    };

    socket.on('error', () => fail(new AppError('NETWORK', 'realtime TTS connection failed')));
    socket.on('event', (event) => {
      if (event.type === 'error') {
        fail(new AppError('TTS', 'realtime TTS rejected the request'));
        return;
      }
      if (event.type === 'session.updated') {
        socket.send({
          type: 'response.create',
          response: {
            conversation: 'none',
            output_modalities: ['audio'],
            tools: [],
            tool_choice: 'none',
            instructions,
            input: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: options.text }],
              },
            ],
          },
        });
        return;
      }
      if (event.type === 'response.output_audio.delta') {
        chunks.push(Buffer.from(event.delta, 'base64'));
        return;
      }
      if (event.type === 'response.output_audio_transcript.delta') {
        streamedTranscript += event.delta;
        return;
      }
      if (event.type === 'response.done') {
        if (event.response.status !== 'completed') {
          fail(new AppError('TTS', 'realtime TTS did not complete'));
          return;
        }
        const transcript = transcriptOf(event.response.output) || streamedTranscript;
        if (!transcriptMatchesText(options.text, transcript)) {
          fail(new AppError('TTS', 'TTS did not speak the supplied text'));
          return;
        }
        const pcm = concat(chunks);
        if (pcm.length < 2) {
          fail(new AppError('TTS', 'empty audio from TTS'));
          return;
        }
        const bytes = pcm16ToWav(pcm);
        const durationMs = wavDurationMs(bytes);
        const reported = usageFromRealtime(event.response, options.model, options.voice);
        if (durationMs !== undefined) reported.outputAudioMs = durationMs;
        options.onUsage?.(reported);
        succeed({ bytes, mimeType: 'audio/wav', durationMs });
      }
    });

    const raw = socket.socket;
    const sendSession = () => {
      socket.send({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: options.model,
          output_modalities: ['audio'],
          tools: [],
          tool_choice: 'none',
          tracing: null,
          instructions,
          audio: {
            input: { turn_detection: null },
            output: {
              format: { type: 'audio/pcm', rate: 24000 },
              voice: options.voice,
              speed: 1,
            },
          },
        },
      });
    };
    if (!raw || raw.readyState === 1) sendSession();
    else {
      const onOpen = () => {
        raw.removeEventListener('open', onOpen);
        sendSession();
      };
      raw.addEventListener('open', onOpen);
    }
    raw?.addEventListener('close', () => fail(new AppError('NETWORK', 'realtime TTS connection closed')));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('TIMEOUT', 'upstream timeout')), options.timeoutMs);
  });
  const abort = new Promise<never>((_, reject) => {
    if (options.signal?.aborted) reject(new AppError('TIMEOUT', 'request aborted'));
    else options.signal?.addEventListener('abort', () => reject(new AppError('TIMEOUT', 'request aborted')), { once: true });
  });

  try {
    return await Promise.race([work, timeout, abort]);
  } finally {
    if (timer) clearTimeout(timer);
    settled = true;
    try {
      socket.close();
    } catch {
      // The utterance is already finished or failed.
    }
  }
}
