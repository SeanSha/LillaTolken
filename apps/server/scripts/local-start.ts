// npm run local:start
// Verifies the local engines and starts the whisper.cpp server on 127.0.0.1 if it is not already
// running. It never installs anything, never downloads a model, never exposes a port beyond
// loopback and never leaves a detached process behind: Ctrl-C stops what it started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadDotenv, serverRoot } from '../src/config';
import { isLoopbackUrl } from '../src/providers/local/config';
import { probeAsr, probeLlm, modelFileExists } from '../src/providers/local/probe';
import { runCommand } from '../src/providers/local/exec';
import { findLanExposure } from '../src/providers/local/exposure';

loadDotenv();
const { local } = loadConfig();
const log = (m: string) => console.log(`[local:start] ${m}`);

if (!isLoopbackUrl(local.whisper.baseUrl) || !isLoopbackUrl(local.ollama.baseUrl)) {
  log('refusing to run: WHISPER_BASE_URL / OLLAMA_BASE_URL must be loopback addresses');
  process.exit(1);
}

const fetchImpl: typeof fetch = (...a) => fetch(...a);
const pidFile = path.join(serverRoot, 'data/whisper-server.pid');

// ---- Ollama (we only verify; starting a system daemon is the user's decision)
const llm = await probeLlm(local, fetchImpl);
if (llm.ok) {
  log(`Ollama OK (${llm.modelTag}). Warming the model so the first turn is not a cold start...`);
  try {
    // Loads the model into memory. No prompt, no content.
    await fetch(`${local.ollama.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: local.ollama.model, keep_alive: local.ollama.keepAlive }),
      signal: AbortSignal.timeout(120_000),
    });
    log('model warm.');
  } catch {
    log('could not pre-warm the model (will load on first request).');
  }
} else {
  log(`Ollama NOT ready [${llm.code}]: ${llm.detail}`);
}

{
  const exposed = await findLanExposure([
    { name: 'Ollama', url: local.ollama.baseUrl },
    { name: 'whisper-server', url: local.whisper.baseUrl },
  ]);
  for (const e of exposed.filter((x) => x.name === 'Ollama')) {
    log(`WARNING: Ollama also answers on ${e.address}:${e.port} (your LAN). Turn off "Expose Ollama to the network" in the Ollama app so only this Mac can use it. See \`npm run local:doctor\`.`);
  }
}

// ---- whisper.cpp server
const port = Number(new URL(local.whisper.baseUrl).port || 80);
const asrBefore = await probeAsr(local, runCommand, fetchImpl);
if (asrBefore.ok) {
  log(`whisper server already running at ${local.whisper.baseUrl} (${asrBefore.modelTag}) - not starting another.`);
  process.exit(llm.ok ? 0 : 1);
}
if (!(await modelFileExists(local.whisper.modelFile))) {
  log(`Whisper model file missing: ${path.relative(process.cwd(), local.whisper.modelFile)}`);
  log('  download once: mkdir -p models/whisper && curl -L -o models/whisper/<file> https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>');
  process.exit(1);
}

log(`starting ${local.whisper.binary} on 127.0.0.1:${port} with ${path.basename(local.whisper.modelFile)} ...`);
const child = spawn(
  local.whisper.binary,
  ['-m', local.whisper.modelFile, '--host', '127.0.0.1', '--port', String(port), '-t', '4', '-sns'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
child.on('error', (e) => {
  log(`could not start whisper-server: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'binary not found (brew install whisper-cpp)' : 'spawn failed'}`);
  process.exit(1);
});
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
if (child.pid) fs.writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
const quiet = (chunk: Buffer) => {
  // Metal shader-compile noise and per-request logs are hidden; real errors are kept.
  for (const line of chunk.toString().split('\n')) if (/error|failed|fatal/i.test(line)) console.log(`[whisper] ${line}`);
};
child.stdout.on('data', quiet);
child.stderr.on('data', quiet);

const stop = () => {
  child.kill('SIGTERM');
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  fs.rmSync(pidFile, { force: true });
  log(`whisper-server exited (code ${code})`);
  process.exit(code ?? 1);
});

// Wait until it answers (first start compiles Metal kernels: can take ~15-60 s).
const deadline = Date.now() + 120_000;
for (;;) {
  const s = await probeAsr(local, runCommand, fetchImpl);
  if (s.ok) {
    log(`whisper server ready at ${local.whisper.baseUrl}  (PID ${child.pid}, ${s.modelTag}).`);
    log(llm.ok ? 'All engines ready. Keep this terminal open; run `npm run dev` in another one. Ctrl-C stops whisper.' : 'Whisper ready, but Ollama is NOT ready (see above).');
    break;
  }
  if (Date.now() > deadline) {
    log('whisper server did not become ready within 120 s.');
    stop();
  }
  await new Promise((r) => setTimeout(r, 1000));
}
