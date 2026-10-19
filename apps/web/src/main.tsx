import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const mount = root;

// /monitor is the adult-only admin dashboard. It is a separate lazy chunk so the child UI bundle
// (and its microphone/dialogue runtime) is never loaded there, and vice versa.
async function start(): Promise<void> {
  if (window.location.pathname === '/monitor' || window.location.pathname.startsWith('/monitor/')) {
    const { MonitorApp } = await import('./monitor/MonitorApp');
    await import('./monitor/monitor.css');
    createRoot(mount).render(<MonitorApp />);
    return;
  }
  const [{ App }] = await Promise.all([import('./ui/App'), import('./styles.css')]);
  // No StrictMode: the dialogue actor owns audio/microphone side effects that must run exactly once.
  createRoot(mount).render(<App />);
}

void start();
