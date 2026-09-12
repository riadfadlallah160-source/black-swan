import fs from 'node:fs/promises';
import { PROVIDERS, RECOMMENDED_RAIL, productionGate } from './provider-selection.js';
import { inspectFlaunch } from './flaunch-client.js';

const live = await inspectFlaunch().catch(error => ({ healthy: false, error: String(error.message) }));
const selected = PROVIDERS.find(item => item.id === RECOMMENDED_RAIL);
const report = {
  generatedAt: new Date().toISOString(),
  recommendation: RECOMMENDED_RAIL,
  providers: PROVIDERS,
  liveEvidence: { flaunch: live },
  productionGate: productionGate(RECOMMENDED_RAIL),
};
await fs.writeFile('data/provider-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ recommendation: selected.id, gate: report.productionGate, live: live.healthy }, null, 2));
