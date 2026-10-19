// npm run local:eval [-- --provider local|cloud --allow-cloud --json]
// Text-only scenario suite on ARTIFICIAL inputs (docs 7.3 / implementation step 5).
// Defaults to the LOCAL model. `cloud` additionally needs --allow-cloud AND a configured key,
// because this script must never spend money by accident.
import { performance } from 'node:perf_hooks';
import { errorCodeOf, type DialogueModel, type InterpretationResult, type RequestMeta } from '@kt/shared';
import { loadConfig, loadDotenv } from '../src/config';
import { createCloudProvider } from '../src/providers/cloud';
import { createLocalProvider } from '../src/providers/local';
import { SV_SCENARIOS, ZH_SCENARIOS } from './scenarios';

loadDotenv();
const config = loadConfig();
const arg = (name: string) => process.argv.includes(name);
const provider = process.argv[process.argv.indexOf('--provider') + 1] === 'cloud' ? 'cloud' : 'local';
const asJson = arg('--json');

let dialogue: DialogueModel;
let tag: string;
if (provider === 'cloud') {
  if (!arg('--allow-cloud') || !config.openai.apiKey) {
    console.log('SKIPPED: cloud run needs --allow-cloud and OPENAI_API_KEY (this suite never spends money by default).');
    process.exit(2);
  }
  dialogue = createCloudProvider(config.openai).dialogue;
  tag = `openai:${config.openai.llmModel}`;
} else {
  dialogue = createLocalProvider(config.local).dialogue;
  tag = `ollama:${config.local.ollama.model}`;
}

type Row = { id: string; kind: string; ms: number; note: string; out: string[]; invalid: boolean };
const rows: Row[] = [];
const meta = (id: string): RequestMeta => ({ taskId: `eval-${id}`, requestId: `eval-${id}-${rows.length}` });

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> {
  const t = performance.now();
  try {
    return { value: await fn(), ms: performance.now() - t };
  } catch (e) {
    return { ms: performance.now() - t, error: errorCodeOf(e) };
  }
}

for (const sc of ZH_SCENARIOS) {
  const inputs = [{ purpose: 'INITIAL' as const, textParts: sc.segments }];
  let total = 0;
  const out: string[] = [];
  let r = await timed(() => dialogue.interpretChinese({ dialogueInputs: inputs, remainingClarifications: 3 }, meta(sc.id)));
  total += r.ms;
  if (r.error || !r.value) {
    rows.push({ id: sc.id, kind: 'ERROR', ms: total, note: r.error ?? '', out, invalid: r.error === 'INVALID_MODEL_OUTPUT' });
    continue;
  }
  let result: InterpretationResult = r.value;
  let kind: string = result.kind;
  let asked = false;
  if (result.kind === 'ASK_CLARIFICATION') {
    asked = true;
    out.push(`Q: ${result.questionZh}`);
    const answered = [...inputs, { purpose: 'CLARIFICATION' as const, textParts: [sc.answer ?? '不知道。'], inReplyTo: result.questionZh }];
    r = await timed(() => dialogue.interpretChinese({ dialogueInputs: answered, remainingClarifications: 2 }, meta(sc.id)));
    total += r.ms;
    if (!r.value) {
      rows.push({ id: sc.id, kind: 'ERROR', ms: total, note: r.error ?? '', out, invalid: r.error === 'INVALID_MODEL_OUTPUT' });
      continue;
    }
    result = r.value;
    kind = `ASK>${result.kind}`;
  }
  if (result.kind === 'PROPOSE_MEANING') {
    out.push(`ZH: ${result.meaningZh}`);
    const t = await timed(() => dialogue.translate({ text: result.kind === 'PROPOSE_MEANING' ? result.meaningZh : '', direction: 'ZH_TO_SV' }, meta(sc.id)));
    total += t.ms;
    out.push(t.error ? `SV: <${t.error}>` : `SV: ${t.value}`);
  }
  const policyOk = sc.expect === 'ANY' || (sc.expect === 'ASK' ? asked : !asked);
  rows.push({ id: sc.id, kind, ms: total, note: policyOk ? '' : `policy-expectation differs (expected ${sc.expect})`, out, invalid: false });
}

for (const sc of SV_SCENARIOS) {
  const t = await timed(() => dialogue.translate({ text: sc.text, direction: 'SV_TO_ZH' }, meta(sc.id)));
  rows.push({ id: sc.id, kind: t.error ? 'ERROR' : 'TRANSLATE', ms: t.ms, note: t.error ?? '', out: [`SV: ${sc.text}`, `ZH: ${t.value ?? ''}`], invalid: t.error === 'INVALID_MODEL_OUTPUT' });
}

if (asJson) {
  console.log(JSON.stringify({ provider, tag, rows }, null, 2));
} else {
  console.log(`\nText-only scenario suite - ${tag}  (artificial inputs; review fidelity by eye)\n`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(10)} ${r.kind.padEnd(26)} ${(r.ms / 1000).toFixed(1).padStart(5)}s ${r.note}`);
    for (const line of r.out) console.log(`           ${line}`);
  }
  const ok = rows.filter((r) => r.kind !== 'ERROR');
  const warm = rows.slice(1).map((r) => r.ms);
  console.log(
    `\n${ok.length}/${rows.length} completed | invalid JSON/schema: ${rows.filter((r) => r.invalid).length} | first call ${(rows[0]!.ms / 1000).toFixed(1)}s | warm mean ${(warm.reduce((a, b) => a + b, 0) / Math.max(1, warm.length) / 1000).toFixed(1)}s per scenario`,
  );
}
process.exit(rows.some((r) => r.kind === 'ERROR') ? 1 : 0);
