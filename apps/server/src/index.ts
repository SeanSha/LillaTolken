import { loadConfig, loadDotenv } from './config';
import { createApp } from './app';
import { createRegistry } from './providers/registry';

loadDotenv();
const config = loadConfig();
const registry = createRegistry(config);
// Probe the loopback engines once so `local` availability is correct from the first request.
await registry.local.refresh?.().catch(() => undefined);
const { app, admin } = createApp({ config, registry });

app.listen(config.port, config.host, () => {
  const presets = (Object.keys(registry) as Array<keyof typeof registry>)
    .map((p) => `${p}=${registry[p].available ? 'available' : 'unavailable'}`)
    .join(' ');
  console.log(`KidsTranslator server on http://${config.host}:${config.port}  [${presets}]`);
  if (!config.openai.apiKey) {
    console.log('  (cloud preset disabled: set OPENAI_API_KEY in .env to enable it)');
  }
  if (!registry.local.available) {
    console.log(`  (local preset unavailable: ${registry.local.unavailableReason ?? 'unknown'} — run \`npm run local:doctor\`)`);
  }
  console.log(`  telemetry: ${config.monitor.dbPath} (metadata only)`);
  if (admin.source === 'env') {
    console.log('  monitor: /monitor  (admin password from MONITOR_ADMIN_PASSWORD)');
  } else if (admin.source === 'generated') {
    // Printed once, at creation. Later starts read it from the 0600 file.
    console.log(`  monitor: /monitor  generated admin password (first run only): ${admin.password}`);
    console.log(`           stored in ${admin.file}  — set MONITOR_ADMIN_PASSWORD to override`);
  } else {
    console.log(`  monitor: /monitor  (admin password in ${admin.file}, or MONITOR_ADMIN_PASSWORD)`);
  }
});
