// npm run local:doctor [-- --json]
// Non-secret Mac hardware + engine + voice report with actionable next steps (docs 5.3 "First: inspect").
import { loadConfig, loadDotenv, repoRoot } from '../src/config';
import { formatDoctor, runDoctor } from '../src/providers/local/doctor';

loadDotenv();
const config = loadConfig();
const report = await runDoctor(config.local, { repoRoot });
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(formatDoctor(report, config.local));
process.exit(report.ready ? 0 : 1);
