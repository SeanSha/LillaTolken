// Local TTS: macOS `say` (docs/SYSTEM_DESIGN.md 5.3). Voices are DISCOVERED at runtime
// (`say -v '?'`), never hardcoded. The binary is invoked with an argument array (no shell) and the
// text goes through a private temp file, so user text can never be parsed as options or by a shell.
// Output is 16-bit PCM WAV, which iPhone Safari plays natively. There is NO cloud fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, type AudioData, type Language, type RequestMeta, type SpeechSynthesizer, PAYLOAD_LIMITS } from '@kt/shared';
import { wavDurationMs } from '../../media/duration';
import { CommandError, type CommandRunner } from './exec';
import { unavailable, withTempDir } from './common';
import type { LocalConfig } from './config';

export type SayVoice = { name: string; locale: string };

/** Parses `say -v '?'` output: "Alva   sv_SE    # Hej! ..." / "Eddy (Chinese (China mainland)) zh_CN  # ...". */
export function parseSayVoices(output: string): SayVoice[] {
  const voices: SayVoice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?)\s+([a-z]{2,3}_[A-Za-z]{2,4})\s+#/.exec(line);
    if (m) voices.push({ name: m[1]!.trim(), locale: m[2]! });
  }
  return voices;
}

const PREFERRED: Record<Language, { locales: string[]; names: string[] }> = {
  // Simplified-Chinese (mainland) voices first; the classic "Tingting" is the dependable default.
  zh: { locales: ['zh_CN', 'zh_TW', 'zh_HK'], names: ['Tingting'] },
  sv: { locales: ['sv_SE'], names: ['Alva'] },
};

/** Picks an installed voice for the language: explicit override > preferred name > first matching locale. */
export function pickVoice(voices: readonly SayVoice[], language: Language, override?: string): SayVoice | undefined {
  if (override) return voices.find((v) => v.name.toLowerCase() === override.toLowerCase());
  const pref = PREFERRED[language];
  for (const locale of pref.locales) {
    const inLocale = voices.filter((v) => v.locale === locale);
    const named = inLocale.find((v) => pref.names.includes(v.name));
    if (named) return named;
    // Prefer simple single-name voices over the long multilingual "Name (Language (Region))" ones.
    const simple = inLocale.find((v) => !v.name.includes('('));
    if (simple ?? inLocale[0]) return simple ?? inLocale[0];
  }
  return undefined;
}

export class LocalSpeechSynthesizer implements SpeechSynthesizer {
  private voicesCache: { at: number; voices: SayVoice[] } | null = null;

  constructor(
    private readonly cfg: LocalConfig,
    private readonly run: CommandRunner,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async listVoices(): Promise<SayVoice[]> {
    if (this.voicesCache && this.now() - this.voicesCache.at < 60_000) return this.voicesCache.voices;
    try {
      const result = await this.run(this.cfg.tts.sayBin, ['-v', '?'], { timeoutMs: 10_000 });
      const voices = parseSayVoices(result.stdout);
      this.voicesCache = { at: this.now(), voices };
      return voices;
    } catch (error) {
      if (error instanceof CommandError && error.kind === 'not_found') throw unavailable('TTS', 'macOS say is not available');
      throw unavailable('TTS', 'could not list macOS voices');
    }
  }

  async voiceFor(language: Language): Promise<SayVoice> {
    const voices = await this.listVoices();
    const override = language === 'zh' ? this.cfg.tts.voiceZh : this.cfg.tts.voiceSv;
    const voice = pickVoice(voices, language, override);
    if (!voice) {
      throw unavailable(
        'TTS',
        override ? `configured ${language} voice "${override}" is not installed` : `no ${language === 'zh' ? 'Mandarin (zh_*)' : 'Swedish (sv_SE)'} macOS voice installed`,
      );
    }
    return voice;
  }

  async synthesize(text: string, language: Language, meta: RequestMeta): Promise<AudioData> {
    if (text.length === 0 || text.length > PAYLOAD_LIMITS.maxTextChars) {
      throw new AppError('BAD_REQUEST', 'text length out of range');
    }
    const voice = await this.voiceFor(language);
    const started = performance.now();
    return withTempDir(this.cfg.tmpRoot, 'kt-tts', async (dir) => {
      const textFile = path.join(dir, 'in.txt');
      const wavFile = path.join(dir, 'out.wav');
      await fs.writeFile(textFile, text, { encoding: 'utf8', mode: 0o600 });
      try {
        const result = await this.run(
          this.cfg.tts.sayBin,
          ['-v', voice.name, '-o', wavFile, '--data-format=LEI16@22050', '-f', textFile],
          { timeoutMs: this.cfg.tts.timeoutMs, signal: meta.signal },
        );
        if (result.code !== 0) throw new AppError('TTS', 'macOS say failed', 'LOCAL_TTS_ERROR');
      } catch (error) {
        if (error instanceof CommandError) {
          if (error.kind === 'not_found') throw unavailable('TTS', 'macOS say is not available');
          if (error.kind === 'timeout') throw new AppError('TIMEOUT', 'local TTS timed out', 'LOCAL_TTS_TIMEOUT');
          throw new AppError('TIMEOUT', 'request aborted', 'LOCAL_TTS_CANCELLED');
        }
        throw error;
      }
      const bytes = new Uint8Array(await fs.readFile(wavFile));
      if (bytes.length < 100) throw new AppError('TTS', 'empty audio from local TTS', 'LOCAL_TTS_ERROR');
      const durationMs = wavDurationMs(bytes);
      meta.report?.({ engineInferenceMs: performance.now() - started, outputAudioMs: durationMs });
      return { bytes, mimeType: 'audio/wav', durationMs };
    });
  }
}
