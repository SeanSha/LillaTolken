// Generates candidate voices for the static spoken prompts so a human can pick one.
// Usage: node --env-file=.env scripts/gen-prompt-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OUT = path.resolve('design/prompt-samples');
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const TEXT = { zh: '现在可以说啦', sv: 'Du kan prata nu' };
const LANGNAME = { zh: 'Mandarin Chinese', sv: 'Swedish' };
const STYLES = {
  gentle: 'in a warm, gentle, soothing tone, like a kind kindergarten teacher talking to a small child. Natural pace, slightly smiling.',
  cheerful: 'in a bright, cheerful, playful and encouraging tone, like a friendly children\'s TV host. Lively but not too fast.',
  calm: 'in a calm, clear, neutral and friendly tone, steady medium pace, easy for a child to understand.',
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
fs.mkdirSync(OUT, { recursive: true });
const jobs = [];
for (const voice of VOICES) for (const lang of ['zh', 'sv']) for (const style of Object.keys(STYLES)) jobs.push({ voice, lang, style });

async function run({ voice, lang, style }) {
  const file = path.join(OUT, `start-${lang}-${voice}-${style}.mp3`);
  try {
    const res = await client.audio.speech.create({
      model: MODEL, voice, input: TEXT[lang], response_format: 'mp3',
      instructions: `Speak ${LANGNAME[lang]} ${STYLES[style]}`,
    });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    console.log('FAILED', voice, lang, style, e.status ?? e.message);
  }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
const ok = new Set(fs.readdirSync(OUT));
const voices = VOICES.filter((v) => ok.has(`start-zh-${v}-gentle.mp3`));
const labels = { gentle: '温柔', cheerful: '活泼', calm: '平静' };
const cell = (lang, v) => Object.keys(STYLES).map((s) => `<div>${labels[s]}<br><audio controls preload="none" src="start-${lang}-${v}-${s}.mp3"></audio></div>`).join('');
const rows = voices.map((v) => `<tr><td><b>${v}</b></td><td class="c">${cell('zh', v)}</td><td class="c">${cell('sv', v)}</td></tr>`).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<meta charset="utf-8"><title>提示语音试听</title><style>body{font:15px system-ui;padding:24px}td{border-bottom:1px solid #ddd;padding:8px}.c{display:flex;gap:10px}audio{width:190px;height:34px}</style><h2>“现在可以说啦” / “Du kan prata nu” 试听</h2><table><tr><th>Voice</th><th>中文(3种语气)</th><th>瑞典语(3种语气)</th></tr>${rows}</table>`);
console.log('done, voices:', voices.join(','), 'files:', ok.size);
