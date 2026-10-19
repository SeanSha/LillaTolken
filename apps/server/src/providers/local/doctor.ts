// `npm run local:doctor`: reports the REAL Mac (never assumes Apple Silicon, 32 GB or a GPU) and
// whether each local engine is installed, running and usable. Contains no secrets, no audio and no
// conversation content, and talks only to 127.0.0.1 and (to detect LAN exposure of the engine
// ports) to this Mac's own interface addresses. Nothing leaves the machine.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalHealthResponse } from '@kt/shared';
import { whisperModelName, type LocalConfig } from './config';
import { CommandError, runCommand, type CommandRunner } from './exec';
import { createLocalProvider } from './index';
import { findLanExposure, type Connector, type Exposure } from './exposure';
import { modelFileExists } from './probe';
import { parseSayVoices, pickVoice } from './tts';

export type ToolStatus = { found: boolean; version?: string };

export type DoctorReport = {
  hardware: {
    platform: string;
    arch: string;
    appleSilicon: boolean;
    macos: string | null;
    chip: string | null;
    cpuCores: number;
    memoryGb: number;
    freeDiskGb: number | null;
    metal: string | null;
  };
  tools: Record<'ollama' | 'ffmpeg' | 'cmake' | 'whisperServer' | 'say' | 'piper' | 'brew', ToolStatus>;
  ollamaModels: Array<{ name: string; sizeGb: number }>;
  whisperModels: Array<{ file: string; sizeMb: number; selected: boolean }>;
  voices: { zh: string[]; sv: string[]; chosenZh: string | null; chosenSv: string | null };
  engines: LocalHealthResponse;
  /** Engine ports that also answer on this Mac's LAN address (must be empty). */
  lanExposure: Exposure[];
  sizing: { recommendedAsr: string; recommendedLlm: string; notes: string[] };
  steps: string[];
  ready: boolean;
};

const GB = 1024 ** 3;

async function tryRun(run: CommandRunner, cmd: string, args: string[], timeoutMs = 8000) {
  try {
    return await run(cmd, args, { timeoutMs });
  } catch (error) {
    if (error instanceof CommandError) return null;
    throw error;
  }
}

async function tool(run: CommandRunner, bin: string, versionArgs: string[] | null): Promise<ToolStatus> {
  const which = await tryRun(run, 'which', [bin], 3000);
  if (!which || which.code !== 0) return { found: false };
  if (!versionArgs) return { found: true };
  const v = await tryRun(run, bin, versionArgs, 5000);
  const first = (v?.stdout || v?.stderr || '').split('\n').find((l) => l.trim());
  return { found: true, version: first?.trim().slice(0, 80) };
}

/** Approximate download sizes (GB) used for the RAM/disk risk estimate BEFORE anything large is pulled. */
const LLM_SIZES: Record<string, number> = { 'qwen3:4b': 2.6, 'qwen3:8b': 5.2, 'qwen3:14b': 9.3 };

export function recommendModels(memoryGb: number): { asr: string; llm: string; notes: string[] } {
  const notes: string[] = [];
  if (memoryGb < 12) {
    notes.push('Under 12 GB RAM: use whisper small and a 4B-class LLM; expect slower Swedish/Chinese quality.');
    return { asr: 'small', llm: 'qwen3:4b', notes };
  }
  if (memoryGb < 24) {
    notes.push('12-23 GB RAM: whisper small + qwen3:8b fits; avoid running other heavy apps during tests.');
    return { asr: 'small', llm: 'qwen3:8b', notes };
  }
  notes.push('24 GB+ RAM: qwen3:8b plus a larger Whisper (large-v3-turbo-q5_0) fits comfortably; a 14B-class LLM is possible if 8B Swedish fidelity proves insufficient.');
  return { asr: 'large-v3-turbo-q5_0 (measure vs small first)', llm: 'qwen3:8b', notes };
}

export async function runDoctor(
  cfg: LocalConfig,
  deps: { run?: CommandRunner; fetchImpl?: typeof fetch; repoRoot: string; connect?: Connector; lanAddresses?: string[] },
): Promise<DoctorReport> {
  const run = deps.run ?? runCommand;
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // ---- hardware
  const arch = os.arch();
  const memoryGb = os.totalmem() / GB;
  const sw = await tryRun(run, 'sw_vers', ['-productVersion'], 3000);
  const profile = await tryRun(run, 'system_profiler', ['SPHardwareDataType', 'SPDisplaysDataType'], 15000);
  const text = profile?.stdout ?? '';
  const chip = /Chip:\s*(.+)/.exec(text)?.[1]?.trim() ?? /Processor Name:\s*(.+)/.exec(text)?.[1]?.trim() ?? null;
  const metal = /Metal(?: Support)?:\s*(.+)/.exec(text)?.[1]?.trim() ?? null;
  const df = await tryRun(run, 'df', ['-k', deps.repoRoot], 3000);
  const dfLine = df?.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/);
  const freeDiskGb = dfLine && dfLine.length >= 4 && Number.isFinite(Number(dfLine[3])) ? Number(dfLine[3]) / (1024 * 1024) : null;
  const appleSilicon = process.platform === 'darwin' && arch === 'arm64';

  // ---- tools
  const [ollama, ffmpeg, cmake, whisperServer, say, piper, brew] = await Promise.all([
    tool(run, 'ollama', ['--version']),
    tool(run, 'ffmpeg', ['-version']),
    tool(run, 'cmake', ['--version']),
    tool(run, cfg.whisper.binary, null),
    tool(run, cfg.tts.sayBin, null),
    tool(run, 'piper', null),
    tool(run, 'brew', ['--version']),
  ]);

  // ---- Ollama models (via the loopback API; no `ollama list` parsing needed)
  let ollamaModels: DoctorReport['ollamaModels'] = [];
  try {
    const res = await fetchImpl(`${cfg.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const body = (await res.json()) as { models?: Array<{ name?: string; size?: number }> };
      ollamaModels = (body.models ?? []).map((m) => ({ name: m.name ?? '?', sizeGb: (m.size ?? 0) / GB }));
    }
  } catch {
    // reported through engines.llm below
  }

  // ---- whisper model files (inside the repo `models/whisper` directory only)
  const modelDir = path.dirname(cfg.whisper.modelFile);
  let files: string[] = [];
  try {
    files = (await fs.readdir(modelDir)).filter((f) => /^ggml-.*\.bin$/.test(f));
  } catch {
    // directory absent
  }
  const whisperModels = await Promise.all(
    files.map(async (file) => ({
      file,
      sizeMb: (await fs.stat(path.join(modelDir, file))).size / (1024 * 1024),
      selected: path.join(modelDir, file) === cfg.whisper.modelFile,
    })),
  );

  // ---- voices (discovered, never hardcoded)
  const voiceList = say.found ? parseSayVoices((await tryRun(run, cfg.tts.sayBin, ['-v', '?'], 8000))?.stdout ?? '') : [];
  const zh = voiceList.filter((v) => v.locale.startsWith('zh_'));
  const sv = voiceList.filter((v) => v.locale.startsWith('sv_'));

  // ---- engines
  const adapter = createLocalProvider(cfg, { run, fetchImpl });
  const engines = await adapter.refresh(true);
  const lanExposure = await findLanExposure(
    [
      { name: 'Ollama', url: cfg.ollama.baseUrl },
      { name: 'whisper-server', url: cfg.whisper.baseUrl },
    ],
    { connect: deps.connect, addresses: deps.lanAddresses },
  );

  // ---- sizing + risks
  const rec = recommendModels(memoryGb);
  const notes = [...rec.notes];
  const wantedSize = LLM_SIZES[cfg.ollama.model];
  if (wantedSize !== undefined && wantedSize > memoryGb * 0.45) {
    notes.push(`RISK: ${cfg.ollama.model} (~${wantedSize} GB) is large relative to ${memoryGb.toFixed(0)} GB RAM; choose ${rec.llm}.`);
  }
  if (freeDiskGb !== null && freeDiskGb < 15) notes.push(`RISK: only ${freeDiskGb.toFixed(0)} GB free disk; models need ~6-8 GB.`);
  if (!appleSilicon) notes.push('NOTE: not Apple Silicon: no Metal acceleration for whisper.cpp/Ollama expected; latency will be higher.');
  if (!ollamaModels.some((m) => m.name.startsWith('qwen3') && !m.name.includes('embedding'))) {
    notes.push(`Candidate LLM tag ${cfg.ollama.model} (~${wantedSize ?? '?'} GB download) - verify with \`ollama show ${cfg.ollama.model}\` after pulling.`);
  }

  // ---- actionable steps
  const steps: string[] = [];
  if (!ffmpeg.found) steps.push('Install ffmpeg: `brew install ffmpeg`');
  if (!ollama.found) steps.push('Install Ollama: `brew install ollama` (or the Ollama app), then start it');
  if (engines.llm.code === 'LOCAL_LLM_UNAVAILABLE') steps.push('Start Ollama: open the Ollama app or run `ollama serve`');
  if (engines.llm.code === 'LOCAL_LLM_MODEL_MISSING') steps.push(`Pull the model once (downloads ~${wantedSize ?? '?'} GB): \`ollama pull ${cfg.ollama.model}\``);
  if (!whisperServer.found) steps.push('Install whisper.cpp: `brew install whisper-cpp` (provides `whisper-server`)');
  if (!(await modelFileExists(cfg.whisper.modelFile))) {
    const name = path.basename(cfg.whisper.modelFile);
    steps.push(`Download the multilingual Whisper model: \`mkdir -p models/whisper && curl -L -o models/whisper/${name} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}\``);
  }
  if (engines.asr.code === 'LOCAL_ASR_UNAVAILABLE' && whisperServer.found && ffmpeg.found) steps.push('Start the Whisper server: `npm run local:start`');
  if (!say.found) steps.push('macOS `say` not found: Local TTS needs macOS (or install Piper: https://github.com/OHF-Voice/piper1-gpl)');
  if (say.found && zh.length === 0) steps.push('No Mandarin voice: System Settings > Accessibility > Spoken Content > System Voice > Manage Voices > add Chinese (China mainland)');
  if (say.found && sv.length === 0) steps.push('No Swedish voice: System Settings > Accessibility > Spoken Content > System Voice > Manage Voices > add Swedish (Alva)');
  for (const e of lanExposure) {
    steps.push(
      e.name === 'Ollama'
        ? `SECURITY: Ollama answers on your LAN address (${e.address}:${e.port}), so anyone on this Wi-Fi can use it. Local engines must be loopback-only: in the Ollama app turn OFF Settings > "Expose Ollama to the network" (or unset OLLAMA_HOST=0.0.0.0), then restart Ollama.`
        : `SECURITY: ${e.name} answers on your LAN address (${e.address}:${e.port}). Restart it bound to 127.0.0.1 (\`npm run local:start\` does this).`,
    );
  }
  if (engines.ready) steps.push('All local engines are ready. Run `npm run local:smoke`, then `npm run dev` and pick the `local` preset.');

  return {
    hardware: {
      platform: process.platform,
      arch,
      appleSilicon,
      macos: sw?.stdout.trim() ?? null,
      chip,
      cpuCores: os.cpus().length,
      memoryGb,
      freeDiskGb,
      metal,
    },
    tools: { ollama, ffmpeg, cmake, whisperServer, say, piper, brew },
    ollamaModels,
    whisperModels,
    voices: {
      zh: zh.map((v) => `${v.name} (${v.locale})`),
      sv: sv.map((v) => `${v.name} (${v.locale})`),
      chosenZh: pickVoice(voiceList, 'zh', cfg.tts.voiceZh)?.name ?? null,
      chosenSv: pickVoice(voiceList, 'sv', cfg.tts.voiceSv)?.name ?? null,
    },
    engines,
    lanExposure,
    sizing: { recommendedAsr: rec.asr, recommendedLlm: rec.llm, notes },
    steps: steps.filter(Boolean),
    ready: engines.ready,
  };
}

export function formatDoctor(r: DoctorReport, cfg: LocalConfig): string {
  const yn = (t: ToolStatus) => (t.found ? `yes${t.version ? ` (${t.version})` : ''}` : 'NO');
  const eng = (name: string, e: LocalHealthResponse['asr']) => `  ${e.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(4)} ${e.modelTag ?? ''}${e.ok ? '' : `  [${e.code}] ${e.detail ?? ''}`}`;
  const lines = [
    '== Hardware ==',
    `  ${r.hardware.chip ?? r.hardware.arch}  | ${r.hardware.arch}${r.hardware.appleSilicon ? ' (Apple Silicon)' : ''} | ${r.hardware.cpuCores} cores | ${r.hardware.memoryGb.toFixed(0)} GB RAM`,
    `  macOS ${r.hardware.macos ?? '?'} | free disk ${r.hardware.freeDiskGb?.toFixed(0) ?? '?'} GB | Metal: ${r.hardware.metal ?? 'not reported'}`,
    '== Tools ==',
    `  ollama ${yn(r.tools.ollama)}`,
    `  ffmpeg ${yn(r.tools.ffmpeg)}`,
    `  cmake  ${yn(r.tools.cmake)}`,
    `  whisper-server ${yn(r.tools.whisperServer)}`,
    `  say    ${yn(r.tools.say)}`,
    `  piper  ${yn(r.tools.piper)} (optional)`,
    '== Installed Ollama models ==',
    ...(r.ollamaModels.length ? r.ollamaModels.map((m) => `  ${m.name}  ${m.sizeGb.toFixed(1)} GB`) : ['  (none reachable)']),
    '== Whisper model files (models/whisper) ==',
    ...(r.whisperModels.length ? r.whisperModels.map((m) => `  ${m.selected ? '*' : ' '} ${m.file}  ${m.sizeMb.toFixed(0)} MB`) : ['  (none)']),
    '== macOS voices ==',
    `  Mandarin: ${r.voices.zh.slice(0, 6).join(', ') || 'NONE'}${r.voices.zh.length > 6 ? ', ...' : ''}  -> using ${r.voices.chosenZh ?? 'NONE'}`,
    `  Swedish : ${r.voices.sv.join(', ') || 'NONE'}  -> using ${r.voices.chosenSv ?? 'NONE'}`,
    `== Engines (${cfg.ollama.baseUrl}, ${cfg.whisper.baseUrl}; loopback only) ==`,
    eng('ASR', r.engines.asr),
    eng('LLM', r.engines.llm),
    eng('TTS', r.engines.tts),
    `  status: ${r.engines.status}`,
    r.lanExposure.length
      ? `  WARN LAN exposure: ${r.lanExposure.map((e) => `${e.name} on ${e.address}:${e.port}`).join(', ')}  (must be loopback-only; see Next steps)`
      : '  OK   LAN exposure: none of the engine ports answer on this Mac\'s LAN address',
    '== Sizing for this Mac ==',
    `  suggested: ASR ${r.sizing.recommendedAsr}; LLM ${r.sizing.recommendedLlm}  (configured: whisper ${whisperModelName(cfg.whisper.modelFile)}, ${cfg.ollama.model})`,
    ...r.sizing.notes.map((n) => `  - ${n}`),
    '== Next steps ==',
    ...(r.steps.length ? r.steps.map((s) => `  - ${s}`) : ['  (nothing to do)']),
  ];
  return lines.join('\n');
}
