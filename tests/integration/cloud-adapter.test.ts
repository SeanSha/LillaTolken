// Cloud adapter logic against a STUB OpenAI client. This does NOT call OpenAI and is NOT
// evidence that the real API integration works (see `npm run check:cloud` for that).
import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { AppError } from '@kt/shared';
import { loadConfig } from '../../apps/server/src/config';
import {
  OpenAIDialogueModel,
  OpenAISpeechRecognizer,
  OpenAISpeechSynthesizer,
  cloudModelTag,
  createCloudProvider,
  extensionForMime,
} from '../../apps/server/src/providers/cloud';

const cfg = loadConfig({ OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv).openai;
const meta = { taskId: 't', requestId: 'r' };

const llmClient = (content: string | null) =>
  ({ chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content } }] })) } } }) as unknown as OpenAI;

describe('OpenAIDialogueModel (stub client)', () => {
  it('maps a valid PROPOSE_MEANING response', async () => {
    const model = new OpenAIDialogueModel(
      llmClient(JSON.stringify({ kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所。', questionZh: '', reasonCode: '' })),
      cfg,
    );
    const r = await model.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['我想去厕所'] }], remainingClarifications: 3 }, meta);
    expect(r).toEqual({ kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所。' });
  });

  it('maps ASK_CLARIFICATION while budget remains', async () => {
    const model = new OpenAIDialogueModel(
      llmClient(JSON.stringify({ kind: 'ASK_CLARIFICATION', meaningZh: '', questionZh: '是什么？', reasonCode: 'REFERENT' })),
      cfg,
    );
    const r = await model.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['那个'] }], remainingClarifications: 1 }, meta);
    expect(r).toMatchObject({ kind: 'ASK_CLARIFICATION', questionZh: '是什么？' });
  });

  it('downgrades a question to UNRESOLVED when the budget is exhausted (model cannot bypass policy)', async () => {
    const model = new OpenAIDialogueModel(
      llmClient(JSON.stringify({ kind: 'ASK_CLARIFICATION', meaningZh: '', questionZh: '是什么？', reasonCode: 'REFERENT' })),
      cfg,
    );
    const r = await model.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['那个'] }], remainingClarifications: 0 }, meta);
    expect(r.kind).toBe('UNRESOLVED');
  });

  it.each([
    ['not JSON', 'sorry I cannot'],
    ['empty content', null],
    ['unknown kind', JSON.stringify({ kind: 'MAYBE', meaningZh: '', questionZh: '', reasonCode: '' })],
    ['empty meaning', JSON.stringify({ kind: 'PROPOSE_MEANING', meaningZh: '  ', questionZh: '', reasonCode: '' })],
    ['empty question', JSON.stringify({ kind: 'ASK_CLARIFICATION', meaningZh: '', questionZh: '', reasonCode: '' })],
    ['array', '[]'],
  ])('rejects invalid model output: %s', async (_name, content) => {
    const model = new OpenAIDialogueModel(llmClient(content as string | null), cfg);
    await expect(
      model.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: ['x'] }], remainingClarifications: 3 }, meta),
    ).rejects.toMatchObject({ category: 'INVALID_MODEL_OUTPUT' });
  });

  it('translate validates {translation} and sends strict json_schema + pinned model', async () => {
    const client = llmClient(JSON.stringify({ translation: 'Jag vill gå på toaletten.' }));
    const model = new OpenAIDialogueModel(client, cfg);
    expect(await model.translate({ text: '我想去厕所。', direction: 'ZH_TO_SV' }, meta)).toBe('Jag vill gå på toaletten.');
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    const params = create.mock.calls[0]?.[0] as { model: string; response_format: { type: string; json_schema: { strict: boolean } }; temperature?: number };
    expect(params.model).toBe('gpt-6-luna');
    expect(params.response_format.type).toBe('json_schema');
    expect(params.response_format.json_schema.strict).toBe(true);
    expect(params).not.toHaveProperty('temperature');

    const bad = new OpenAIDialogueModel(llmClient(JSON.stringify({ translation: '' })), cfg);
    await expect(bad.translate({ text: 'x', direction: 'SV_TO_ZH' }, meta)).rejects.toMatchObject({ category: 'INVALID_MODEL_OUTPUT' });
  });

  it('still sends temperature 0 for a non-GPT-6 Cloud model', async () => {
    const older = loadConfig({ OPENAI_API_KEY: 'k', OPENAI_LLM_MODEL: 'gpt-4.1-mini' } as NodeJS.ProcessEnv).openai;
    const client = llmClient(JSON.stringify({ translation: 'Hej' }));
    await new OpenAIDialogueModel(client, older).translate({ text: '你好', direction: 'ZH_TO_SV' }, meta);
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: 'gpt-4.1-mini', temperature: 0 });
  });

  it('omits temperature when configured empty (reasoning models)', async () => {
    const noTemp = loadConfig({ OPENAI_API_KEY: 'k', OPENAI_LLM_TEMPERATURE: '' } as NodeJS.ProcessEnv).openai;
    const client = llmClient(JSON.stringify({ translation: 'Hej' }));
    await new OpenAIDialogueModel(client, noTemp).translate({ text: '你好', direction: 'ZH_TO_SV' }, meta);
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
  });

  it('puts previousDelivered in the prompt only as optional context', async () => {
    const client = llmClient(JSON.stringify({ translation: 'Hej' }));
    await new OpenAIDialogueModel(client, cfg).translate(
      { text: '你好', direction: 'ZH_TO_SV', previousDelivered: { taskId: 'a', direction: 'SV_TO_ZH', source: 'Hej', translation: '你好' } },
      meta,
    );
    const create = (client as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create;
    const messages = (create.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages[0]?.content).toContain('optional context only');
    expect(JSON.parse(messages[1]?.content ?? '{}').previousDelivered.source).toBe('Hej');
  });
});

describe('OpenAI ASR/TTS adapters (stub client)', () => {
  it('ASR uploads with a Safari-friendly extension, requested language and pinned model', async () => {
    const create = vi.fn(async (_params: unknown) => ({ text: '  我想去厕所。 ' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const text = await new OpenAISpeechRecognizer(client, cfg).transcribe(
      { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/mp4' },
      'zh',
      meta,
    );
    expect(text).toBe('我想去厕所。');
    const params = create.mock.calls[0]?.[0] as { file: { name: string }; model: string; language?: string; languages?: string[] };
    expect(params.file.name).toBe('segment.m4a');
    expect(params.model).toBe('gpt-transcribe');
    expect(params.languages).toEqual(['cmn']);
    expect(params).not.toHaveProperty('language');
  });

  it('keeps the singular language field for the previous transcription models', async () => {
    const older = { ...cfg, asrModel: 'gpt-4o-transcribe' };
    const create = vi.fn(async (_params: unknown) => ({ text: 'hej' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    await new OpenAISpeechRecognizer(client, older).transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' }, 'sv', meta);
    const params = create.mock.calls[0]?.[0] as { model: string; language?: string; languages?: string[] };
    expect(params).toMatchObject({ model: 'gpt-4o-transcribe', language: 'sv' });
    expect(params).not.toHaveProperty('languages');
  });

  it('the Speech API fallback returns mp3 and treats an empty body as a TTS failure', async () => {
    const speech = { ...cfg, ttsModel: 'gpt-4o-mini-tts' };
    const create = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const ok = { audio: { speech: { create } } } as unknown as OpenAI;
    const audio = await new OpenAISpeechSynthesizer(ok, speech).synthesize('Hej', 'sv', meta);
    expect(audio.mimeType).toBe('audio/mpeg');
    expect(audio.bytes.length).toBe(3);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: 'gpt-4o-mini-tts', response_format: 'mp3', voice: 'alloy' });

    const empty = { audio: { speech: { create: vi.fn(async () => new Response(new Uint8Array())) } } } as unknown as OpenAI;
    await expect(new OpenAISpeechSynthesizer(empty, speech).synthesize('Hej', 'sv', meta)).rejects.toMatchObject({ category: 'TTS' });
  });

  it('maps upstream failures to content-free categories', async () => {
    const make = (status: number) => {
      const error = Object.assign(new Error('boom with user text'), { status });
      Object.setPrototypeOf(error, OpenAI.APIError.prototype);
      return error;
    };
    const client = { audio: { transcriptions: { create: vi.fn(async () => { throw make(401); }) } } } as unknown as OpenAI;
    await expect(
      new OpenAISpeechRecognizer(client, cfg).transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' }, 'sv', meta),
    ).rejects.toMatchObject({ category: 'NOT_CONFIGURED' });
  });
});

describe('misc', () => {
  it('extensionForMime covers Safari and Chrome recorder output', () => {
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionForMime('audio/wav')).toBe('wav');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
  });

  it('modelTag is non-secret and includes pinned models and prompt version', () => {
    const tag = cloudModelTag(cfg);
    expect(tag).toContain(cfg.llmModel);
    expect(tag).toContain('prompt=');
    expect(tag).not.toContain('test-key');
  });

  it('without a key the cloud bundle fails with NOT_CONFIGURED and never constructs a client', async () => {
    const bundle = createCloudProvider(loadConfig({} as NodeJS.ProcessEnv).openai);
    await expect(bundle.tts.synthesize('x', 'zh', meta)).rejects.toBeInstanceOf(AppError);
    await expect(bundle.tts.synthesize('x', 'zh', meta)).rejects.toMatchObject({ category: 'NOT_CONFIGURED' });
  });
});
