// HTTP pairing: the phone sends a code, the monitor stays behind the admin cookie, RTT is a separate probe.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { loadConfig } from '../../apps/server/src/config';
import { EventStore } from '../../apps/server/src/evaluation/eventStore';
import { createRegistry } from '../../apps/server/src/providers/registry';

const PASSWORD = 'test-admin-password';
const SECRET = 'sk-test-secret-should-not-leak';

async function boot() {
  process.env.NODE_ENV = 'test';
  const config = loadConfig({
    PERSIST_EVENTS: 'off',
    LOCAL_ENABLED: 'off',
    MONITOR_DB_PATH: ':memory:',
    MONITOR_ADMIN_PASSWORD: PASSWORD,
    OPENAI_API_KEY: SECRET,
  } as NodeJS.ProcessEnv);
  const { app } = createApp({ config, registry: createRegistry(config), events: new EventStore() });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe('evaluation session HTTP API', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    h = await boot();
  });
  afterAll(() => new Promise<void>((resolve) => h.server.close(() => resolve())));

  async function login() {
    const res = await fetch(`${h.baseUrl}/api/monitor/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  it('requires the monitor password for session admin, and a test code for the phone probe', async () => {
    expect((await fetch(`${h.baseUrl}/api/monitor/test-runs`)).status).toBe(401);
    expect((await fetch(`${h.baseUrl}/api/monitor/comparison`)).status).toBe(401);
    const bare = await fetch(`${h.baseUrl}/api/eval/ping`);
    expect(bare.status).toBe(401);
    expect(bare.headers.get('cache-control')).toContain('no-store');

    const cookie = await login();
    const denied = await fetch(`${h.baseUrl}/api/monitor/test-runs`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    expect(denied.status).toBe(400);

    const created = await fetch(`${h.baseUrl}/api/monitor/test-runs`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'kitchen', environment: 'HOME', networkType: 'WIFI', noiseLevel: 'QUIET', notes: 'quiet room' }),
    });
    expect(created.status).toBe(201);
    const { run, path } = (await created.json()) as { run: { testRunId: string; code: string; environment: string }; path: string };
    expect(path).toBe(`/?eval=${run.code}`);

    const ping = await fetch(`${h.baseUrl}/api/eval/ping?n=abc`, { headers: { 'X-Test-Code': run.code } });
    expect(ping.status).toBe(200);
    expect(ping.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(await ping.json())).not.toContain('quiet room');

    const task = async (taskId: string, code?: string) => {
      const headers: Record<string, string> = {
        'X-Provider-Preset': 'mock',
        'X-Task-Id': taskId,
        'X-Request-Id': `${taskId}-r`,
        'X-Session-Id': 'phone-1',
        'X-Direction': 'ZH_TO_SV',
        'Content-Type': 'audio/mp4',
        'X-Duration-Ms': '1000',
        'X-Mock-Transcript': encodeURIComponent('sentinel-transcript-not-for-export'),
      };
      if (code) headers['X-Test-Code'] = code;
      const res = await fetch(`${h.baseUrl}/api/asr?language=zh`, { method: 'POST', headers, body: new Uint8Array([1, 2, 3]) });
      expect(res.ok).toBe(true);
    };
    await task('paired', run.code);

    const other = await fetch(`${h.baseUrl}/api/monitor/test-runs`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'park', environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'NOISY' }),
    });
    const park = ((await other.json()) as { run: { code: string; testRunId: string } }).run;
    await task('other-phone', park.code);

    const changed = await fetch(`${h.baseUrl}/api/monitor/test-runs/${run.testRunId}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: 'OUTDOOR', networkType: 'CELLULAR', noiseLevel: 'MODERATE' }),
    });
    expect(changed.status).toBe(200);
    await task('after-change', run.code);

    const ended = await fetch(`${h.baseUrl}/api/monitor/test-runs/${run.testRunId}/end`, { method: 'POST', headers: { Cookie: cookie } });
    expect(ended.status).toBe(200);
    await task('after-end', run.code);
    expect((await fetch(`${h.baseUrl}/api/eval/ping`, { headers: { 'X-Test-Code': run.code } })).status).toBe(401);

    const detail = async (taskId: string) => {
      const res = await fetch(`${h.baseUrl}/api/monitor/tasks/${taskId}`, { headers: { Cookie: cookie } });
      return (await res.json()) as { task: { testRunId: string | null; environment: string; networkType: string; modelConfigId: string | null }; requests: Array<{ modelTag: string; durationMs: number }> };
    };
    const first = await detail('paired');
    const later = await detail('after-change');
    const dropped = await detail('after-end');
    const secondPhone = await detail('other-phone');
    expect(first.task).toMatchObject({ testRunId: run.testRunId, environment: 'HOME', networkType: 'WIFI' });
    expect(later.task).toMatchObject({ testRunId: run.testRunId, environment: 'OUTDOOR', networkType: 'CELLULAR' });
    expect(dropped.task.environment).toBe('UNKNOWN');
    expect(dropped.task.testRunId).toBeNull();
    expect(secondPhone.task.testRunId).toBe(park.testRunId);
    expect(first.task.modelConfigId).toMatch(/^mc_[a-f0-9]{20}$/);
    expect(first.requests[0]!.modelTag).toBe('mock');

    const rtt = await fetch(`${h.baseUrl}/api/eval/rtt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Code': park.code },
      body: JSON.stringify({ rttMs: 55, nonce: 'probe-1' }),
    });
    expect(rtt.status).toBe(204);
    const comparison = (await (await fetch(`${h.baseUrl}/api/monitor/comparison`, { headers: { Cookie: cookie } })).json()) as {
      homeWifi: { httpRtt: { count: number } };
      outdoorCellular: { httpRtt: { medianMs: number | null; count: number }; stages: Array<{ stage: string; medianMs: number | null }> };
    };
    expect(comparison.outdoorCellular.httpRtt).toMatchObject({ count: 1, medianMs: 55 });
    expect(comparison.outdoorCellular.stages.find((s) => s.stage === 'ASR')!.medianMs).not.toBe(55);
    expect(comparison.homeWifi.httpRtt.count).toBe(0);

    const csv = await (await fetch(`${h.baseUrl}/api/monitor/export?type=requests&format=csv`, { headers: { Cookie: cookie } })).text();
    expect(csv).toContain('environment');
    expect(csv).toContain('UNKNOWN');
    expect(csv).not.toContain(SECRET);
    expect(csv).not.toContain('sentinel-transcript-not-for-export');
    const sessions = await (await fetch(`${h.baseUrl}/api/monitor/export?type=test-runs&format=csv`, { headers: { Cookie: cookie } })).text();
    expect(sessions).toContain('kitchen');
    expect(sessions).toContain(run.code);
    expect(sessions).not.toContain(SECRET);
  });
});