// Pairs this browser tab with one researcher-issued test session.
// The code lives in sessionStorage only. Nothing about the study is shown in the child UI.
import { TEST_CODE_RE } from '@kt/shared';

const STORAGE_KEY = 'kt.testCode';

export function captureTestCodeFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('eval');
  if (!raw) return;
  const code = raw.trim().toUpperCase();
  if (TEST_CODE_RE.test(code)) sessionStorage.setItem(STORAGE_KEY, code);
  params.delete('eval');
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}

export function getTestCode(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  const code = sessionStorage.getItem(STORAGE_KEY) ?? '';
  return TEST_CODE_RE.test(code) ? code : undefined;
}

export function clearTestCode(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Measures one application-level HTTP round trip and stores it against the paired session.
 * Skips quietly when this tab is not paired. Never sends audio or text.
 */
export async function measureHttpRtt(fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<void> {
  const code = getTestCode();
  if (!code || (typeof document !== 'undefined' && document.hidden)) return;
  const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(`/api/eval/ping?n=${encodeURIComponent(nonce)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'X-Test-Code': code, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
  } catch {
    return;
  }
  const rttMs = Math.round(performance.now() - started);
  if (response.status === 401) {
    clearTestCode();
    return;
  }
  if (!response.ok || rttMs < 0 || rttMs > 60_000) return;
  try {
    await fetchImpl('/api/eval/rtt', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Test-Code': code, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ rttMs, nonce }),
    });
  } catch {
    // A failed probe must not affect the translator.
  }
}

export function startRttProbe(): () => void {
  if (!getTestCode()) return () => undefined;
  const timer = setInterval(() => void measureHttpRtt(), 20_000);
  const first = setTimeout(() => void measureHttpRtt(), 1_500);
  return () => {
    clearInterval(timer);
    clearTimeout(first);
  };
}
