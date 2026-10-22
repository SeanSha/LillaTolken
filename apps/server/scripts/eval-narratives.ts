// Optional manual check of narrative interpretation on ARTIFICIAL inputs.
// Prints to the terminal only. It does not write a results file and does not
// overwrite historical pilot rows.
//
//   npm run eval:narratives -- --provider cloud --allow-cloud
//   npm run eval:narratives -- --provider local
//
// Cloud is refused unless --allow-cloud and OPENAI_API_KEY are both present.
import { performance } from 'node:perf_hooks';
import { errorCodeOf, type DialogueModel, type RequestMeta } from '@kt/shared';
import { loadConfig, loadDotenv } from '../src/config';
import { createCloudProvider } from '../src/providers/cloud';
import { PROMPT_VERSION } from '../src/providers/cloud/prompts';
import { createLocalProvider } from '../src/providers/local';
import { NARRATIVE_SCENARIOS, assessNarrative } from './narrativeScenarios';

loadDotenv();
const config = loadConfig();
const arg = (name: string) => process.argv.includes(name);
const providerName = process.argv[process.argv.indexOf('--provider') + 1] === 'local' ? 'local' : 'cloud';
const asJson = arg('--json');

let dialogue: DialogueModel;
let tag: string;
if (providerName === 'cloud') {
  if (!arg('--allow-cloud') || !config.openai.apiKey) {
    console.log('SKIPPED: cloud narrative eval needs --allow-cloud and OPENAI_API_KEY. Nothing was sent.');
    process.exit(2);
  }
  dialogue = createCloudProvider(config.openai).dialogue;
  tag = `openai:${config.openai.llmModel};prompt=${PROMPT_VERSION}`;
} else {
  dialogue = createLocalProvider(config.local).dialogue;
  tag = `ollama:${config.local.ollama.model};prompt=${PROMPT_VERSION}`;
}

type Row = { id: string; remaining: number; kind: string; ms: number; ok: boolean; reasons: string[]; out: string };
const rows: Row[] = [];

async function runCase(id: string, index: number): Promise<void> {
  const scenario = NARRATIVE_SCENARIOS.find((item) => item.id === id);
  const spec = scenario?.cases[index];
  if (!scenario || !spec) return;
  const meta: RequestMeta = { taskId: `narrative-${id}`, requestId: `narrative-${id}-${index}` };
  const started = performance.now();
  try {
    const result = await dialogue.interpretChinese(
      { dialogueInputs: scenario.dialogueInputs, remainingClarifications: spec.remainingClarifications },
      meta,
    );
    const assessed = assessNarrative(scenario, index, result);
    const out =
      result.kind === 'PROPOSE_MEANING' ? result.meaningZh : result.kind === 'ASK_CLARIFICATION' ? result.questionZh : result.reasonCode;
    rows.push({
      id,
      remaining: spec.remainingClarifications,
      kind: result.kind,
      ms: performance.now() - started,
      ok: assessed.ok,
      reasons: assessed.reasons,
      out,
    });
  } catch (error) {
    rows.push({
      id,
      remaining: spec.remainingClarifications,
      kind: 'ERROR',
      ms: performance.now() - started,
      ok: false,
      reasons: [errorCodeOf(error)],
      out: '',
    });
  }
}

for (const scenario of NARRATIVE_SCENARIOS) {
  for (let index = 0; index < scenario.cases.length; index += 1) await runCase(scenario.id, index);
}

if (asJson) {
  console.log(JSON.stringify({ provider: providerName, tag, promptVersion: PROMPT_VERSION, rows }, null, 2));
} else {
  console.log(`\nNarrative policy check - ${tag}  (artificial inputs; review wording by eye)\n`);
  for (const row of rows) {
    const mark = row.ok ? 'ok' : 'DIFF';
    console.log(`${row.id.padEnd(6)} budget=${row.remaining} ${row.kind.padEnd(18)} ${mark.padEnd(4)} ${(row.ms / 1000).toFixed(1).padStart(5)}s`);
    if (row.out) console.log(`       ${row.out}`);
    if (row.reasons.length) console.log(`       ${row.reasons.join('; ')}`);
  }
  const passed = rows.filter((row) => row.ok).length;
  console.log(`\n${passed}/${rows.length} matched the policy rubric. This is not a claim about real child speech.`);
}

process.exit(rows.every((row) => row.ok) ? 0 : 1);
