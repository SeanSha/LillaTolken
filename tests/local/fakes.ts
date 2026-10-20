// Shared fakes for the Local provider tests: a command runner (ffmpeg / say) and a fetch (whisper / Ollama).
import fs from 'node:fs/promises';
import type { CommandError, CommandRunner, RunResult } from '../../apps/server/src/providers/local/exec';

export function makeWav(ms: number, rate = 16000): Uint8Array {
  const dataBytes = Math.round((ms / 1000) * rate) * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buf);
}

export const SAY_VOICES = [
  'Alva                sv_SE    # Hej! Jag heter Alva.',
  'Eddy (Chinese (China mainland)) zh_CN    # 你好！我叫Eddy。',
  'Tingting            zh_CN    # 你好！我叫婷婷。',
  'Samantha            en_US    # Hello! My name is Samantha.',
].join('\n');

export type Call = { command: string; args: readonly string[] };

export type RunnerOptions = {
  ffmpegCode?: number;
  ffmpegError?: CommandError;
  sayError?: CommandError;
  voices?: string;
  textsSeen?: string[];
};

export function fakeRunner(opts: RunnerOptions = {}) {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args): Promise<RunResult> => {
    calls.push({ command, args: [...args] });
    if (command === 'ffmpeg') {
      if (opts.ffmpegError) throw opts.ffmpegError;
      if (args.includes('-version')) return { code: 0, stdout: 'ffmpeg version test', stderr: '' };
      if (opts.ffmpegCode) return { code: opts.ffmpegCode, stdout: '', stderr: 'decode error' };
      await fs.writeFile(args.at(-1)!, makeWav(2000, 16000));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (command === 'say') {
      if (args[0] === '-v' && args[1] === '?') return { code: 0, stdout: opts.voices ?? SAY_VOICES, stderr: '' };
      if (opts.sayError) throw opts.sayError; // only the synthesis call fails; voice discovery works
      const out = args[args.indexOf('-o') + 1]!;
      const textFile = args[args.indexOf('-f') + 1]!;
      opts.textsSeen?.push(await fs.readFile(textFile, 'utf8'));
      await fs.writeFile(out, makeWav(1500, 22050));
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

export type FetchLog = { url: string; init?: RequestInit };

export type FetchHandlers = {
  whisper?: (init: RequestInit) => Response | Promise<Response>;
  chat?: (body: Record<string, unknown>) => Response | Promise<Response>;
  tags?: () => Response;
  root?: () => Response;
};

export function fakeFetch(handlers: FetchHandlers) {
  const log: FetchLog[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, init });
    if (url.endsWith('/inference')) return handlers.whisper ? handlers.whisper(init!) : Response.json({ text: '我想去厕所。\n' });
    if (url.endsWith('/api/chat')) return handlers.chat ? handlers.chat(JSON.parse(String(init!.body))) : Response.json({ message: { content: '{}' } });
    if (url.endsWith('/api/tags')) return handlers.tags ? handlers.tags() : Response.json({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3-vl:8b' }] });
    return handlers.root ? handlers.root() : new Response('<html>whisper</html>');
  }) as typeof fetch;
  return { impl, log };
}
