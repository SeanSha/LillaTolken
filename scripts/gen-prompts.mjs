// Generates the static spoken prompts (apps/web/public/prompts/<id>-<lang>.mp3) with OpenAI TTS.
// Keep TEXT in sync with PROMPT_TEXT in apps/web/src/audio/prompts.ts (that copy is the offline fallback).
// Usage: node --env-file=.env scripts/gen-prompts.mjs [id ...]   (needs ffmpeg for the lead-in silence)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import OpenAI from 'openai';

const MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OUT = path.resolve('apps/web/public/prompts');
const TEXT = {
  start: { zh: '请说吧', sv: 'Varsågod' },
  continue: { zh: '还有吗？', sv: 'Något mer?' },
  switch: { zh: '要换一个吗？', sv: 'Vill du byta?' },
  asrEmpty: { zh: '没听清，再说一次好吗？', sv: 'Kan du säga det igen?' },
  fallback: { zh: '我们重新开始吧', sv: 'Vi börjar om' },
  error: { zh: '出了点小问题', sv: 'Något gick fel' },
};
const VOICE = {
  zh: { voice: 'alloy', instructions: 'Speak Mandarin Chinese in a warm, gentle, soothing tone, like a kind kindergarten teacher talking to a small child. Natural pace, slightly smiling.' },
  sv: { voice: 'marin', instructions: "Speak Swedish in a bright, cheerful, playful and encouraging tone, like a friendly children's TV host. Lively but not too fast." },
};
/** Silence before the voice so the first syllable survives audio-session switches on phones. */
const LEAD_IN_S = 0.15;

/** Trim the silence TTS adds at both ends, so the prompt ends exactly when the voice does. */
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';

const only = process.argv.slice(2);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-prompts-'));
for (const [id, langs] of Object.entries(TEXT)) {
  if (only.length && !only.includes(id)) continue;
  for (const lang of ['zh', 'sv']) {
    const res = await client.audio.speech.create({ model: MODEL, input: langs[lang], response_format: 'mp3', ...VOICE[lang] });
    const raw = path.join(tmp, `${id}-${lang}.mp3`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    const out = path.join(OUT, `${id}-${lang}.mp3`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `${TRIM},adelay=${Math.round(LEAD_IN_S * 1000)}:all=1,loudnorm=I=-18:TP=-2`, '-ar', '44100', '-ac', '1', '-b:a', '64k', out]);
    console.log('wrote', path.relative('.', out));
  }
}
