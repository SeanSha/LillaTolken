// Cloud smoke test using SYNTHETIC text only. Needs OPENAI_API_KEY + network.
//   npm run check:cloud
// Pipeline: TTS(zh) -> ASR(zh) -> interpret -> translate(zh->sv) -> TTS(sv) -> ASR(sv) -> translate(sv->zh)
// Exit code 0 = all stages passed, 2 = skipped (no key), 1 = failure.
import { loadConfig, loadDotenv } from '../src/config';
import { createCloudProvider, cloudModelTag } from '../src/providers/cloud';

loadDotenv();
const config = loadConfig();

if (!config.openai.apiKey) {
  console.log('SKIPPED: OPENAI_API_KEY is not set. Nothing was tested against OpenAI.');
  process.exit(2);
}

const provider = createCloudProvider(config.openai);
const meta = (n: number) => ({ taskId: 'smoke', requestId: `smoke-${n}` });
const results: Array<{ stage: string; ms: number; ok: boolean; note: string }> = [];

async function stage<T>(name: string, fn: () => Promise<T>, note: (v: T) => string): Promise<T> {
  const t0 = Date.now();
  try {
    const value = await fn();
    results.push({ stage: name, ms: Date.now() - t0, ok: true, note: note(value) });
    return value;
  } catch (error) {
    const category = (error as { category?: string }).category ?? 'UNKNOWN';
    results.push({ stage: name, ms: Date.now() - t0, ok: false, note: `${category}: ${(error as Error).message}` });
    throw error;
  }
}

console.log(`modelTag: ${cloudModelTag(config.openai)}`);
try {
  const zhText = '我想去厕所。';
  const zhAudio = await stage('tts zh', () => provider.tts.synthesize(zhText, 'zh', meta(1)), (a) => `${a.bytes.length} bytes ${a.mimeType}`);
  const zhHeard = await stage('asr zh', () => provider.asr.transcribe(zhAudio, 'zh', meta(2)), (t) => `"${t}"`);
  const interp = await stage(
    'interpret',
    () => provider.dialogue.interpretChinese({ dialogueInputs: [{ purpose: 'INITIAL', textParts: [zhHeard || zhText] }], remainingClarifications: 3 }, meta(3)),
    (r) => r.kind,
  );
  const meaning = interp.kind === 'PROPOSE_MEANING' ? interp.meaningZh : zhText;
  const sv = await stage('translate zh->sv', () => provider.dialogue.translate({ text: meaning, direction: 'ZH_TO_SV' }, meta(4)), (t) => `"${t}"`);
  const svAudio = await stage('tts sv', () => provider.tts.synthesize(sv, 'sv', meta(5)), (a) => `${a.bytes.length} bytes`);
  const svHeard = await stage('asr sv', () => provider.asr.transcribe(svAudio, 'sv', meta(6)), (t) => `"${t}"`);
  await stage('translate sv->zh', () => provider.dialogue.translate({ text: svHeard || sv, direction: 'SV_TO_ZH' }, meta(7)), (t) => `"${t}"`);
} catch {
  // recorded in results
}

console.table(results);
process.exit(results.every((r) => r.ok) && results.length === 7 ? 0 : 1);
