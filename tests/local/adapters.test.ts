// Local provider adapters with MOCKED engines (no Ollama/whisper/ffmpeg/say needed).
// Covers acceptance L07/L08 logic, M05 (ns -> ms) and the security rules: loopback only, no shell,
// request-scoped temp files, content-free errors. Real engines are exercised by `npm run local:smoke`.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, errorCodeOf, type NormalizedUsage, type RequestMeta } from '@kt/shared';
import { cleanWhisperText } from '../../apps/server/src/providers/local/whisper';
import { createLocalProvider, localModelTag } from '../../apps/server/src/providers/local';
import { createLocalVocabularyIdentifier } from '../../apps/server/src/providers/local/vision';
import { isLoopbackUrl, loadLocalConfig, whisperModelName, type LocalConfig } from '../../apps/server/src/providers/local/config';
import { CommandError } from '../../apps/server/src/providers/local/exec';
import { findLanExposure, lanAddresses } from '../../apps/server/src/providers/local/exposure';
import { ollamaHasModel, overallStatus } from '../../apps/server/src/providers/local/probe';
import { parseSayVoices, pickVoice } from '../../apps/server/src/providers/local/tts';
import { audioDurationMs, mp3DurationMs, wavDurationMs } from '../../apps/server/src/media/duration';
import { runDoctor, recommendModels } from '../../apps/server/src/providers/local/doctor';
import { SAY_VOICES, fakeFetch, fakeRunner, makeWav, type RunnerOptions } from './fakes';

// ------------------------------------------------------------------ fixtures

let tmpRoot = '';
let cfg: LocalConfig;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-local-test-'));
  cfg = loadLocalConfig({ LOCAL_TMP_DIR: tmpRoot } as NodeJS.ProcessEnv, '/repo');
});
afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const audio = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/mp4', durationMs: 2100 };
const meta = (over: Partial<RequestMeta> = {}, usage?: NormalizedUsage[]): RequestMeta => ({
  taskId: 't',
  requestId: 'r',
  report: usage ? (u) => usage.push(u) : undefined,
  ...over,
});
const leftovers = () => fs.readdir(tmpRoot);
const ollamaChat = (content: unknown, extra: Record<string, unknown> = {}) => Response.json({ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, ...extra });

// ------------------------------------------------------------------ pure helpers

describe('config + helpers', () => {
  it('defaults: qwen3:8b, whisper small, loopback only; env overrides apply', () => {
    const c = loadLocalConfig({} as NodeJS.ProcessEnv, '/repo');
    expect(c.ollama.baseUrl).toBe('http://127.0.0.1:11434');
    expect(c.ollama.model).toBe('qwen3:8b');
    expect(c.ollama.visionModel).toBe('qwen3-vl:8b');
    expect(c.ollama.visionTimeoutMs).toBe(120_000);
    expect(c.whisper.baseUrl).toBe('http://127.0.0.1:8080');
    expect(c.whisper.modelFile).toBe(path.join('/repo', 'models/whisper/ggml-small.bin'));
    expect(whisperModelName(c.whisper.modelFile)).toBe('small');
    const o = loadLocalConfig({ OLLAMA_MODEL: 'qwen3:14b', WHISPER_MODEL: '/abs/ggml-large-v3-turbo-q5_0.bin', LOCAL_ENABLED: 'off', OLLAMA_BASE_URL: 'http://localhost:1/' } as NodeJS.ProcessEnv, '/repo');
    expect(o.ollama.model).toBe('qwen3:14b');
    expect(whisperModelName(o.whisper.modelFile)).toBe('large-v3-turbo-q5_0');
    expect(o.enabled).toBe(false);
    expect(o.ollama.baseUrl).toBe('http://localhost:1');
    expect(localModelTag(c)).toContain('ollama/qwen3:8b');
    expect(localModelTag(c)).toContain('vision=ollama/qwen3-vl:8b');
    expect(localModelTag(c)).toContain('whisper.cpp/small');
    const vision = loadLocalConfig({ OLLAMA_VISION_MODEL: 'qwen2.5vl:7b', OLLAMA_VISION_TIMEOUT_MS: '150000' } as NodeJS.ProcessEnv, '/repo');
    expect(vision.ollama.visionModel).toBe('qwen2.5vl:7b');
    expect(vision.ollama.visionTimeoutMs).toBe(150_000);
    expect(createLocalProvider(c).modelFor('IDENTIFY')).toBe('ollama:qwen3-vl:8b');
    expect(createLocalProvider(c).modelFor('TRANSLATE')).toBe('ollama:qwen3:8b');
  });

  it('isLoopbackUrl accepts only loopback hosts', () => {
    for (const u of ['http://127.0.0.1:8080', 'http://localhost:11434', 'http://[::1]:1']) expect(isLoopbackUrl(u), u).toBe(true);
    for (const u of ['http://192.168.1.5:8080', 'https://api.openai.com', 'http://0.0.0.0:1', 'nonsense']) expect(isLoopbackUrl(u), u).toBe(false);
  });

  it('cleanWhisperText strips non-speech markers only, joins zh without spaces and sv with spaces', () => {
    expect(cleanWhisperText('[BLANK_AUDIO]', 'zh')).toBe('');
    expect(cleanWhisperText(' (music) \n', 'sv')).toBe('');
    expect(cleanWhisperText('我想\n去厕所。\n', 'zh')).toBe('我想去厕所。');
    expect(cleanWhisperText(' Jag vill\n gå hem. [MUSIC]', 'sv')).toBe('Jag vill gå hem.');
    expect(cleanWhisperText('Kan jag få (lite) vatten?', 'sv')).toBe('Kan jag få (lite) vatten?'); // ordinary parentheses are speech
  });

  it('parseSayVoices / pickVoice discover voices from `say -v ?` output and honour overrides', () => {
    const voices = parseSayVoices(SAY_VOICES);
    expect(voices.map((v) => `${v.name}|${v.locale}`)).toEqual(['Alva|sv_SE', 'Eddy (Chinese (China mainland))|zh_CN', 'Tingting|zh_CN', 'Samantha|en_US']);
    expect(pickVoice(voices, 'zh')?.name).toBe('Tingting');
    expect(pickVoice(voices, 'sv')?.name).toBe('Alva');
    expect(pickVoice(voices, 'zh', 'eddy (chinese (china mainland))')?.name).toBe('Eddy (Chinese (China mainland))');
    expect(pickVoice(voices, 'zh', 'NoSuchVoice')).toBeUndefined();
    expect(pickVoice(voices.filter((v) => v.locale !== 'sv_SE'), 'sv')).toBeUndefined();
  });

  it('ollamaHasModel treats a bare name as :latest and compares tags exactly', () => {
    expect(ollamaHasModel(['qwen3:8b', 'llama3.2:latest'], 'qwen3:8b')).toBe(true);
    expect(ollamaHasModel(['llama3.2:latest'], 'llama3.2')).toBe(true);
    expect(ollamaHasModel(['qwen3:14b'], 'qwen3:8b')).toBe(false);
  });

  it('overallStatus reports the first failing engine, e.g. LOCAL_TTS_UNAVAILABLE', () => {
    const ok = { ok: true };
    expect(overallStatus({ asr: ok, llm: ok, tts: ok })).toEqual({ ready: true, status: 'LOCAL_READY' });
    expect(overallStatus({ asr: ok, llm: ok, tts: { ok: false, code: 'LOCAL_TTS_UNAVAILABLE' } })).toEqual({ ready: false, status: 'LOCAL_TTS_UNAVAILABLE' });
  });

  it('media duration: WAV header, streamed WAV and mp3 frames', () => {
    expect(wavDurationMs(makeWav(2500, 22050))).toBe(2500);
    const streamed = makeWav(1000, 16000);
    new DataView(streamed.buffer).setUint32(40, 0xffffffff, true);
    expect(wavDurationMs(streamed)).toBe(1000);
    expect(wavDurationMs(new Uint8Array(10))).toBeUndefined();
    // 10 MPEG1 Layer III frames @128 kbps/44.1 kHz: frame = 417 bytes (+1 padding on some) = 26.12 ms each
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    const mp3 = new Uint8Array(417 * 10);
    for (let i = 0; i < 10; i++) mp3.set(frame, i * 417);
    expect(mp3DurationMs(mp3)).toBeGreaterThan(255);
    expect(mp3DurationMs(mp3)).toBeLessThan(265);
    expect(audioDurationMs(mp3, 'audio/mpeg')).toBe(mp3DurationMs(mp3));
    expect(audioDurationMs(makeWav(500), 'audio/wav')).toBe(500);
    expect(audioDurationMs(mp3, 'audio/ogg')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ ASR

describe('Local ASR (whisper.cpp + ffmpeg)', () => {
  it('zh: converts with ffmpeg (argument array), posts explicit language + Simplified prompt, reports sub-steps', async () => {
    const { run, calls } = fakeRunner();
    let form!: FormData;
    const { impl, log } = fakeFetch({ whisper: (init) => ((form = init.body as FormData), Response.json({ text: ' 我想去厕所。\n' })) });
    const usage: NormalizedUsage[] = [];
    const text = await createLocalProvider(cfg, { run, fetchImpl: impl }).asr.transcribe(audio, 'zh', meta({}, usage));
    expect(text).toBe('我想去厕所。');

    const ff = calls.find((c) => c.command === 'ffmpeg')!;
    expect(ff.args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-nostdin']));
    expect(ff.args.every((a) => typeof a === 'string')).toBe(true);
    expect(String(ff.args[ff.args.indexOf('-i') + 1])).toMatch(/\.m4a$|\.mp4$/); // iPhone AAC/MP4 input is passed through ffmpeg

    expect(form.get('language')).toBe('zh');
    expect(form.get('prompt')).toBe('以下是普通话的句子。');
    expect(form.get('response_format')).toBe('json');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(log.map((l) => new URL(l.url).hostname)).toEqual(['127.0.0.1']);

    expect(usage[0]!.conversionMs).toBeGreaterThanOrEqual(0);
    expect(usage[0]!.engineInferenceMs).toBeGreaterThanOrEqual(0);
    expect(usage[0]!.inputAudioMs).toBe(2000); // measured on the converted WAV
    expect(await leftovers()).toEqual([]); // temp audio removed
  });

  it('sv: explicit language, NO Chinese prompt, blank audio becomes an empty transcript', async () => {
    const { run } = fakeRunner();
    let form!: FormData;
    const { impl } = fakeFetch({ whisper: (init) => ((form = init.body as FormData), Response.json({ text: '[BLANK_AUDIO]\n' })) });
    const text = await createLocalProvider(cfg, { run, fetchImpl: impl }).asr.transcribe(audio, 'sv', meta());
    expect(text).toBe('');
    expect(form.get('language')).toBe('sv');
    expect(form.has('prompt')).toBe(false);
  });

  it('L07: whisper not running -> LOCAL_ASR_UNAVAILABLE, only loopback was contacted, no cloud fallback, temp cleaned', async () => {
    const { run } = fakeRunner();
    const { impl, log } = fakeFetch({
      whisper: () => {
        throw new TypeError('fetch failed');
      },
    });
    const error = await createLocalProvider(cfg, { run, fetchImpl: impl }).asr.transcribe(audio, 'zh', meta()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(errorCodeOf(error)).toBe('LOCAL_ASR_UNAVAILABLE');
    expect(log.every((l) => isLoopbackUrl(l.url))).toBe(true);
    expect(await leftovers()).toEqual([]);
  });

  it('maps HTTP errors, missing text, timeouts and cancellation to distinct content-free codes', async () => {
    const { run } = fakeRunner();
    const code = async (whisper: () => Response | Promise<Response>, m: RequestMeta = meta()) => {
      const { impl } = fakeFetch({ whisper });
      return errorCodeOf(await createLocalProvider(cfg, { run, fetchImpl: impl }).asr.transcribe(audio, 'zh', m).catch((e: unknown) => e));
    };
    expect(await code(() => new Response('boom', { status: 500 }))).toBe('LOCAL_ASR_ERROR');
    expect(await code(() => Response.json({ nothing: true }))).toBe('LOCAL_ASR_ERROR');
    expect(
      await code(() => {
        throw new DOMException('t', 'TimeoutError');
      }),
    ).toBe('LOCAL_ASR_TIMEOUT');
    const controller = new AbortController();
    controller.abort();
    expect(
      await code(() => {
        throw new DOMException('a', 'AbortError');
      }, meta({ signal: controller.signal })),
    ).toBe('LOCAL_ASR_CANCELLED');
    expect(await leftovers()).toEqual([]);
  });

  it('bad / undecodable audio -> LOCAL_ASR_BAD_AUDIO (400-class), missing ffmpeg -> LOCAL_ASR_UNAVAILABLE', async () => {
    const { impl } = fakeFetch({});
    const bad = await createLocalProvider(cfg, { run: fakeRunner({ ffmpegCode: 1 }).run, fetchImpl: impl }).asr.transcribe(audio, 'zh', meta()).catch((e: unknown) => e);
    expect(errorCodeOf(bad)).toBe('LOCAL_ASR_BAD_AUDIO');
    expect((bad as AppError).category).toBe('BAD_REQUEST');
    const missing = await createLocalProvider(cfg, { run: fakeRunner({ ffmpegError: new CommandError('not_found', 'x') }).run, fetchImpl: impl }).asr.transcribe(audio, 'zh', meta()).catch((e: unknown) => e);
    expect(errorCodeOf(missing)).toBe('LOCAL_ASR_UNAVAILABLE');
    const timeout = await createLocalProvider(cfg, { run: fakeRunner({ ffmpegError: new CommandError('timeout', 'x') }).run, fetchImpl: impl }).asr.transcribe(audio, 'zh', meta()).catch((e: unknown) => e);
    expect(errorCodeOf(timeout)).toBe('LOCAL_ASR_TIMEOUT');
    expect(await leftovers()).toEqual([]);
  });
});

// ------------------------------------------------------------------ LLM

describe('Local LLM (Ollama)', () => {
  const interpretInput = { dialogueInputs: [{ purpose: 'INITIAL' as const, textParts: ['我想去厕所。'] }], remainingClarifications: 3 };

  it('M05: Ollama nanosecond durations are normalised to ms; the cold-start load is separate from compute', async () => {
    let sent: Record<string, unknown> = {};
    const { impl, log } = fakeFetch({
      chat: (body) => (
        (sent = body),
        ollamaChat({ translation: 'Jag vill gå på toaletten.' }, { prompt_eval_count: 120, eval_count: 15, total_duration: 3_000_000_000, load_duration: 800_000_000, eval_duration: 900_000_000 })
      ),
    });
    const usage: NormalizedUsage[] = [];
    const out = await createLocalProvider(cfg, { fetchImpl: impl }).dialogue.translate({ text: '我想去厕所。', direction: 'ZH_TO_SV' }, meta({}, usage));
    expect(out).toBe('Jag vill gå på toaletten.');
    expect(usage[0]).toMatchObject({ promptTokens: 120, outputTokens: 15, modelLoadMs: 800, engineInferenceMs: 2200 });
    // request shape
    expect(sent).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, keep_alive: '30m', options: { temperature: 0, seed: 0 } });
    expect(sent.format).toBeTypeOf('object'); // JSON-schema constrained decoding
    expect((sent.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['system', 'user']);
    expect(log).toHaveLength(1);
    expect(new URL(log[0]!.url).host).toBe('127.0.0.1:11434');
  });

  it('missing duration fields are simply not reported (never invented)', async () => {
    const { impl } = fakeFetch({ chat: () => ollamaChat({ translation: 'Hej' }) });
    const usage: NormalizedUsage[] = [];
    await createLocalProvider(cfg, { fetchImpl: impl }).dialogue.translate({ text: 'x', direction: 'ZH_TO_SV' }, meta({}, usage));
    expect(usage[0]!.engineInferenceMs).toBeUndefined();
    expect(usage[0]!.modelLoadMs).toBeUndefined();
  });

  it('interpretation is validated by the SAME schema/policy as Cloud: ask, propose, and the clarification budget cap', async () => {
    const run = async (content: unknown, remaining = 3) => {
      const { impl } = fakeFetch({ chat: () => ollamaChat(content) });
      return createLocalProvider(cfg, { fetchImpl: impl }).dialogue.interpretChinese({ ...interpretInput, remainingClarifications: remaining }, meta());
    };
    expect(await run({ kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所。' })).toEqual({ kind: 'PROPOSE_MEANING', meaningZh: '我想去厕所。' });
    expect(await run({ kind: 'ASK_CLARIFICATION', questionZh: '你想去哪里？', reasonCode: 'AMBIGUOUS' })).toMatchObject({ kind: 'ASK_CLARIFICATION' });
    // Budget exhausted: a model that still asks is overruled server-side (L06-style policy safety).
    expect(await run({ kind: 'ASK_CLARIFICATION', questionZh: '什么？', reasonCode: 'X' }, 0)).toEqual({ kind: 'UNRESOLVED', reasonCode: 'CLARIFICATION_BUDGET_EXHAUSTED' });
  });

  it('invalid JSON / schema from the model -> INVALID_MODEL_OUTPUT (no raw model text in the error)', async () => {
    for (const content of ['not json', '{"kind":"PROPOSE_MEANING"}', '{"translation":""}', '']) {
      const { impl } = fakeFetch({ chat: () => ollamaChat(content) });
      const llm = createLocalProvider(cfg, { fetchImpl: impl }).dialogue;
      const error = await (content.includes('translation') ? llm.translate({ text: 'x', direction: 'ZH_TO_SV' }, meta()) : llm.interpretChinese(interpretInput, meta())).catch((e: unknown) => e);
      expect((error as AppError).category).toBe('INVALID_MODEL_OUTPUT');
      expect((error as AppError).message).not.toContain('not json');
    }
  });

  it('L08: model not installed (HTTP 404) -> LOCAL_LLM_MODEL_MISSING, never rerouted anywhere', async () => {
    const { impl, log } = fakeFetch({ chat: () => new Response('{"error":"model not found"}', { status: 404 }) });
    const error = await createLocalProvider(cfg, { fetchImpl: impl }).dialogue.translate({ text: 'x', direction: 'ZH_TO_SV' }, meta()).catch((e: unknown) => e);
    expect(errorCodeOf(error)).toBe('LOCAL_LLM_MODEL_MISSING');
    expect(log).toHaveLength(1);
  });

  it('L07: Ollama down / error body / timeout / cancel map to LOCAL_LLM_* codes', async () => {
    const code = async (chat: () => Response, m: RequestMeta = meta()) => {
      const { impl } = fakeFetch({ chat });
      return errorCodeOf(await createLocalProvider(cfg, { fetchImpl: impl }).dialogue.translate({ text: 'x', direction: 'ZH_TO_SV' }, m).catch((e: unknown) => e));
    };
    expect(
      await code(() => {
        throw new TypeError('fetch failed');
      }),
    ).toBe('LOCAL_LLM_UNAVAILABLE');
    expect(await code(() => new Response('x', { status: 500 }))).toBe('LOCAL_LLM_ERROR');
    expect(await code(() => Response.json({ error: 'oom' }))).toBe('LOCAL_LLM_ERROR');
    expect(
      await code(() => {
        throw new DOMException('t', 'TimeoutError');
      }),
    ).toBe('LOCAL_LLM_TIMEOUT');
    const c = new AbortController();
    c.abort();
    expect(
      await code(() => {
        throw new DOMException('a', 'AbortError');
      }, meta({ signal: c.signal })),
    ).toBe('LOCAL_LLM_CANCELLED');
  });
});

// ------------------------------------------------------------------ vision

describe('Local vision (Ollama photo vocabulary)', () => {
  const photo = { bytes: Uint8Array.from([9, 8, 7, 6, 5]), mimeType: 'image/jpeg' as const, kind: 'jpeg' as const };

  it('posts the image only to loopback Ollama and normalises the card', async () => {
    let sent: Record<string, unknown> = {};
    const { impl, log } = fakeFetch({
      chat: (body) => (
        (sent = body),
        ollamaChat(
          { outcome: 'object', candidates: [{ zh: '杯子', sv: 'kopp', article: 'en', translationUncertain: false, category: 'home' }] },
          { prompt_eval_count: 40, eval_count: 12, total_duration: 5_000_000_000, load_duration: 1_000_000_000 },
        )
      ),
    });
    const usage: NormalizedUsage[] = [];
    const result = await createLocalVocabularyIdentifier(cfg, impl).identify(photo, undefined, (u) => usage.push(u));
    expect(result.candidates[0]).toMatchObject({ zh: '杯子', sv: 'kopp', article: 'en', category: 'home' });
    expect(usage[0]).toMatchObject({ promptTokens: 40, outputTokens: 12, modelLoadMs: 1000, engineInferenceMs: 4000 });
    expect(sent.model).toBe('qwen3-vl:8b');
    expect((sent.options as { num_ctx?: number }).num_ctx).toBeUndefined();
    const user = (sent.messages as Array<{ role: string; images?: string[] }>).find((m) => m.role === 'user');
    expect(user?.images).toEqual([Buffer.from(photo.bytes).toString('base64')]);
    expect(log).toHaveLength(1);
    expect(new URL(log[0]!.url).host).toBe('127.0.0.1:11434');
    expect(await leftovers()).toEqual([]);
  });

  it('does not call out when local is off or Ollama is not on loopback', async () => {
    const { impl, log } = fakeFetch({});
    const off = await createLocalVocabularyIdentifier({ ...cfg, enabled: false }, impl).identify(photo).catch((e: unknown) => e);
    expect(errorCodeOf(off)).toBe('LOCAL_DISABLED');
    const lan = await createLocalVocabularyIdentifier({ ...cfg, ollama: { ...cfg.ollama, baseUrl: 'http://10.1.2.3:11434' } }, impl)
      .identify(photo)
      .catch((e: unknown) => e);
    expect(errorCodeOf(lan)).toBe('LOCAL_LLM_UNAVAILABLE');
    expect(log).toHaveLength(0);
    expect(JSON.stringify(lan)).not.toContain(Buffer.from(photo.bytes).toString('base64'));
  });

  it('a missing vision model, bad JSON and an unreachable engine stay content-free', async () => {
    const b64 = Buffer.from(photo.bytes).toString('base64');
    const missing = fakeFetch({ chat: () => new Response(b64, { status: 404 }) });
    const missingError = await createLocalVocabularyIdentifier(cfg, missing.impl).identify(photo).catch((e: unknown) => e);
    expect(errorCodeOf(missingError)).toBe('LOCAL_LLM_MODEL_MISSING');
    expect((missingError as AppError).message).not.toContain(b64);
    const bad = fakeFetch({ chat: () => ollamaChat(`not json ${b64}`) });
    const invalid = await createLocalVocabularyIdentifier(cfg, bad.impl).identify(photo).catch((e: unknown) => e);
    expect((invalid as AppError).category).toBe('INVALID_MODEL_OUTPUT');
    expect((invalid as AppError).message).not.toContain(b64);
    const down = fakeFetch({
      chat: () => {
        throw new TypeError(`fetch failed ${b64}`);
      },
    });
    const unreachable = await createLocalVocabularyIdentifier(cfg, down.impl).identify(photo).catch((e: unknown) => e);
    expect(errorCodeOf(unreachable)).toBe('LOCAL_LLM_UNAVAILABLE');
    expect((unreachable as AppError).message).not.toContain(b64);
  });
});

// ------------------------------------------------------------------ TTS

describe('Local TTS (macOS say)', () => {
  it('uses an argument array, a discovered voice and a private text FILE (text never appears in argv)', async () => {
    const textsSeen: string[] = [];
    const { run, calls } = fakeRunner({ textsSeen });
    const usage: NormalizedUsage[] = [];
    const secretText = 'Jag vill gå; rm -rf / $(whoami) `id`';
    const audioOut = await createLocalProvider(cfg, { run }).tts.synthesize(secretText, 'sv', meta({}, usage));
    expect(audioOut.mimeType).toBe('audio/wav');
    expect(audioOut.durationMs).toBe(1500);
    expect(usage[0]!.outputAudioMs).toBe(1500); // media length, not processing time
    expect(usage[0]!.engineInferenceMs).toBeGreaterThanOrEqual(0);

    const say = calls.filter((c) => c.command === 'say' && c.args[0] === '-v' && c.args[1] !== '?')[0]!;
    expect(say.args[1]).toBe('Alva');
    expect(say.args).toContain('--data-format=LEI16@22050');
    expect(JSON.stringify(say.args)).not.toContain('rm -rf'); // shell metacharacters never reach argv
    expect(textsSeen).toEqual([secretText]); // delivered intact through the temp file
    expect(await leftovers()).toEqual([]);
  });

  it('picks Tingting for zh and honours LOCAL_TTS_VOICE_* overrides', async () => {
    const zh = fakeRunner();
    await createLocalProvider(cfg, { run: zh.run }).tts.synthesize('你好', 'zh', meta());
    expect(zh.calls.find((c) => c.args.includes('-o'))!.args[1]).toBe('Tingting');
    const o = fakeRunner();
    const overridden = { ...cfg, tts: { ...cfg.tts, voiceZh: 'Eddy (Chinese (China mainland))' } };
    await createLocalProvider(overridden, { run: o.run }).tts.synthesize('你好', 'zh', meta());
    expect(o.calls.find((c) => c.args.includes('-o'))!.args[1]).toBe('Eddy (Chinese (China mainland))');
  });

  it('L08: a missing voice -> LOCAL_TTS_UNAVAILABLE with an actionable message (no cloud TTS)', async () => {
    const { run } = fakeRunner({ voices: 'Samantha en_US # Hello' });
    const error = await createLocalProvider(cfg, { run }).tts.synthesize('你好', 'zh', meta()).catch((e: unknown) => e);
    expect(errorCodeOf(error)).toBe('LOCAL_TTS_UNAVAILABLE');
    expect((error as AppError).message).toMatch(/Mandarin/);
  });

  it('say missing / timeout / abort / oversize text are all visible, content-free errors (temp files removed)', async () => {
    const code = async (opts: RunnerOptions, text = 'hej') =>
      errorCodeOf(await createLocalProvider(cfg, { run: fakeRunner(opts).run }).tts.synthesize(text, 'sv', meta()).catch((e: unknown) => e));
    expect(await code({ sayError: new CommandError('not_found', 'x') })).toBe('LOCAL_TTS_UNAVAILABLE');
    expect(await code({ sayError: new CommandError('timeout', 'x') })).toBe('LOCAL_TTS_TIMEOUT');
    expect(await code({ sayError: new CommandError('aborted', 'x') })).toBe('LOCAL_TTS_CANCELLED');
    const tooLong = await createLocalProvider(cfg, { run: fakeRunner().run }).tts.synthesize('x'.repeat(5000), 'sv', meta()).catch((e: unknown) => e);
    expect((tooLong as AppError).category).toBe('BAD_REQUEST');
    expect(await leftovers()).toEqual([]);
  });
});

// ------------------------------------------------------------------ health / provider

describe('LocalProvider health + guard rails', () => {
  it('all engines up -> LOCAL_READY with model tags; probing never leaves loopback and makes no billable call', async () => {
    const { run } = fakeRunner();
    const { impl, log } = fakeFetch({});
    const provider = createLocalProvider(cfg, { run, fetchImpl: impl });
    const health = await provider.refresh(true);
    expect(health).toMatchObject({ ready: true, status: 'LOCAL_READY' });
    expect(health.llm.modelTag).toBe('ollama:qwen3:8b');
    expect(health.vision.ok).toBe(true);
    expect(health.vision.modelTag).toBe('ollama:qwen3-vl:8b');
    expect(health.tts.modelTag).toBe('macos_say:zh=Tingting;sv=Alva');
    expect(log.every((l) => isLoopbackUrl(l.url) && !l.url.includes('/api/chat') && !l.url.includes('/inference'))).toBe(true);
    expect(provider.describe().available).toBe(true);
  });

  it.each([
    ['Ollama down', { tags: () => { throw new TypeError('fetch failed'); } }, 'LOCAL_LLM_UNAVAILABLE'],
    ['model missing', { tags: () => Response.json({ models: [{ name: 'other:1b' }] }) }, 'LOCAL_LLM_MODEL_MISSING'],
    ['whisper down', { root: () => { throw new TypeError('fetch failed'); } }, 'LOCAL_ASR_UNAVAILABLE'],
  ])('%s is reported with its own status code (and describe() says unavailable)', async (_name, handlers, status) => {
    const { run } = fakeRunner();
    const provider = createLocalProvider(cfg, { run, fetchImpl: fakeFetch(handlers as never).impl });
    const health = await provider.refresh(true);
    expect(health.ready).toBe(false);
    expect(health.status).toBe(status);
    expect(provider.describe().available).toBe(false);
    expect(provider.describe().reason).toContain(status);
  });

  it('a busy engine (probe timeout) is "ready but busy", not down', async () => {
    const { run } = fakeRunner();
    const { impl } = fakeFetch({
      tags: () => {
        throw new DOMException('t', 'TimeoutError');
      },
    });
    const health = await createLocalProvider(cfg, { run, fetchImpl: impl }).refresh(true);
    expect(health.llm.ok).toBe(true);
    expect(health.llm.detail).toBe('busy');
    expect(health.vision.ok).toBe(true);
    expect(health.vision.detail).toBe('busy');
  });

  it('missing ffmpeg or a non-loopback base URL makes ASR/LLM unavailable instead of trusting the setting', async () => {
    const { impl } = fakeFetch({});
    const noFfmpeg = await createLocalProvider(cfg, { run: fakeRunner({ ffmpegError: new CommandError('not_found', 'x') }).run, fetchImpl: impl }).refresh(true);
    expect(noFfmpeg.asr.code).toBe('LOCAL_ASR_UNAVAILABLE');
    expect(noFfmpeg.asr.detail).toMatch(/ffmpeg/);
    const lan = { ...cfg, whisper: { ...cfg.whisper, baseUrl: 'http://192.168.1.9:8080' }, ollama: { ...cfg.ollama, baseUrl: 'http://192.168.1.9:11434' } };
    const h = await createLocalProvider(lan, { run: fakeRunner().run, fetchImpl: impl }).refresh(true);
    expect(h.asr.detail).toMatch(/loopback/);
    expect(h.llm.detail).toMatch(/loopback/);
    expect(h.vision.detail).toMatch(/loopback/);
    expect(h.ready).toBe(false);
  });

  it('records the last engine failure code (sanitized) for the monitor, and ignores cancellations', async () => {
    const { run } = fakeRunner();
    const { impl } = fakeFetch({
      chat: () => {
        throw new TypeError('fetch failed');
      },
    });
    const provider = createLocalProvider(cfg, { run, fetchImpl: impl });
    expect(provider.health().lastError).toBeNull();
    await provider.dialogue.translate({ text: 'secret words', direction: 'ZH_TO_SV' }, meta()).catch(() => undefined);
    expect(provider.health().lastError?.code).toBe('LOCAL_LLM_UNAVAILABLE');
    expect(JSON.stringify(provider.health())).not.toContain('secret words');
  });

  it('LOCAL_ENABLED=off: every call fails visibly with LOCAL_DISABLED and nothing is contacted', async () => {
    const { impl, log } = fakeFetch({});
    const { run, calls } = fakeRunner();
    const off = createLocalProvider({ ...cfg, enabled: false }, { run, fetchImpl: impl });
    const error = await off.dialogue.translate({ text: 'x', direction: 'ZH_TO_SV' }, meta()).catch((e: unknown) => e);
    expect(errorCodeOf(error)).toBe('LOCAL_DISABLED');
    expect(errorCodeOf(await off.asr.transcribe(audio, 'zh', meta()).catch((e: unknown) => e))).toBe('LOCAL_DISABLED');
    expect((await off.refresh(true)).status).toBe('LOCAL_DISABLED');
    expect(log).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('a missing vision model is visible, and translation stays ready', async () => {
    const { run } = fakeRunner();
    const { impl } = fakeFetch({ tags: () => Response.json({ models: [{ name: 'qwen3:8b' }] }) });
    const health = await createLocalProvider(cfg, { run, fetchImpl: impl }).refresh(true);
    expect(health.ready).toBe(true);
    expect(health.status).toBe('LOCAL_READY');
    expect(health.llm.ok).toBe(true);
    expect(health.vision.ok).toBe(false);
    expect(health.vision.code).toBe('LOCAL_LLM_MODEL_MISSING');
    expect(health.vision.detail).toMatch(/ollama pull qwen3-vl:8b/);
    const report = await runDoctor(cfg, { run, fetchImpl: impl, repoRoot: tmpRoot, connect: async () => false, lanAddresses: [] });
    expect(report.engines.ready).toBe(true);
    expect(report.steps.join('\n')).toMatch(/ollama pull qwen3-vl:8b/);
    expect(report.steps.join('\n')).toMatch(/Photo vocabulary still needs the vision model/);
  });

  it('reuses a probe result for the TTL (cheap /api/health polling) and re-probes when forced', async () => {
    const { run } = fakeRunner();
    const { impl, log } = fakeFetch({});
    let now = 1_000_000;
    const provider = createLocalProvider(cfg, { run, fetchImpl: impl, now: () => now });
    await provider.refresh();
    const first = log.length;
    await provider.refresh();
    expect(log.length).toBe(first);
    now += cfg.probeTtlMs + 1;
    await provider.refresh();
    expect(log.length).toBeGreaterThan(first);
    const afterTtl = log.length;
    await provider.refresh(true);
    expect(log.length).toBeGreaterThan(afterTtl);
  });
});

// ------------------------------------------------------------------ doctor + LAN exposure

describe('local:doctor', () => {
  it('flags an engine port that also answers on the LAN address (and stays quiet when none does)', async () => {
    const exposed = await findLanExposure(
      [
        { name: 'Ollama', url: 'http://127.0.0.1:11434' },
        { name: 'whisper-server', url: 'http://127.0.0.1:8080' },
      ],
      { addresses: ['192.168.1.20'], connect: async (_h, port) => port === 11434 },
    );
    expect(exposed).toEqual([{ name: 'Ollama', port: 11434, address: '192.168.1.20' }]);
    expect(await findLanExposure([{ name: 'Ollama', url: 'http://127.0.0.1:11434' }], { addresses: ['10.0.0.2'], connect: async () => false })).toEqual([]);
    expect(await findLanExposure([{ name: 'x', url: 'not a url' }], { addresses: ['10.0.0.2'], connect: async () => true })).toEqual([]);
    expect(lanAddresses({ en0: [{ address: '192.168.1.2', family: 'IPv4', internal: false } as never, { address: '127.0.0.1', family: 'IPv4', internal: true } as never, { address: 'fe80::1', family: 'IPv6', internal: false } as never] })).toEqual(['192.168.1.2']);
  });

  it('builds a hardware-aware report with actionable steps and no secrets', async () => {
    const { run } = fakeRunner();
    const { impl } = fakeFetch({});
    const report = await runDoctor(cfg, { run, fetchImpl: impl, repoRoot: tmpRoot, connect: async (_h, port) => port === 11434, lanAddresses: ['192.168.1.20'] });
    expect(report.hardware.memoryGb).toBeGreaterThan(0);
    expect(report.engines.ready).toBe(true);
    expect(report.voices.chosenZh).toBe('Tingting');
    expect(report.voices.chosenSv).toBe('Alva');
    expect(report.lanExposure).toHaveLength(1);
    expect(report.steps.join('\n')).toMatch(/SECURITY: Ollama answers on your LAN/);
    expect(JSON.stringify(report)).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('recommends models from the real RAM size', () => {
    expect(recommendModels(8).llm).toBe('qwen3:4b');
    expect(recommendModels(8).vision).toBe('qwen3-vl:4b');
    expect(recommendModels(16).llm).toBe('qwen3:8b');
    expect(recommendModels(16).vision).toBe('qwen3-vl:8b');
    expect(recommendModels(32).llm).toBe('qwen3:8b');
    expect(recommendModels(32).vision).toBe('qwen3-vl:8b');
    expect(recommendModels(32).asr).toMatch(/large-v3-turbo/);
  });
});
