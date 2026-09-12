import fs from 'node:fs/promises';
import { inspectFlaunch } from './flaunch-client.js';
import { LAUNCH_REQUIREMENTS } from './launch-policy.js';

let flaunch;
try {
  flaunch = await inspectFlaunch();
} catch (error) {
  flaunch = { healthy: false, productionEligible: false, error: String(error.message).slice(0, 300) };
}
const result = {
  checkedAt: new Date().toISOString(),
  requirements: LAUNCH_REQUIREMENTS,
  operational: false,
  readOnly: true,
  flaunch,
  blockers: [
    'Flaunch: required free 10% founder allocation is not verified.',
    'Flaunch: automatic fee and allocation payouts are not verified.',
    'Clanker partner: account sponsorship and 2,400/day capacity are not verified.',
    'Direct wallet deployment: user-paid gas conflicts with the zero-cost requirement.',
  ],
  sources: [
    'https://web2-api.flaunch.gg/livez',
    'https://web2-api.flaunch.gg/api/v1/config',
    'https://docs.flaunch.gg/references/api',
    'https://clanker.gitbook.io/documentation/api-reference/authenticated',
    'https://docs.bankr.bot/token-launching/overview/',
  ],
};
await fs.writeFile('data/rail-readiness.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
