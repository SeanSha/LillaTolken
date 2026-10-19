import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorApiError } from './api';

export type Polled<T> = { data: T | null; error: MonitorApiError | null; loading: boolean; refresh: () => void; updatedAt: number | null };

/**
 * Polls `fn` every `intervalMs` (design: ~3-5 s). Polling pauses while the tab is hidden so the
 * dashboard never hammers the Mac during inference, and resumes with an immediate refresh.
 */
export function usePolled<T>(fn: () => Promise<T>, deps: readonly unknown[], intervalMs: number | null): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<MonitorApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const result = await fnRef.current();
      if (mine !== seq.current) return; // a newer request (filter change) superseded this one
      setData(result);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof MonitorApiError ? e : new MonitorApiError(0, 'UNKNOWN'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void run();
    if (intervalMs === null) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, run]);

  return { data, error, loading, refresh: () => void run(), updatedAt };
}
