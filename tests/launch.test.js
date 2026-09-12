import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildFlaunchPayload } from '../src/flaunch-payload.js';
import { inspectFlaunch, readFlaunch, classifyFlaunchJob, verifyFlaunchJob } from '../src/flaunch-client.js';
import { assertZeroCostRail, nextLaunchAt } from '../src/launch-policy.js';
import { CONFIG } from '../src/config.js';

const cid = 'QmX7UbPKJ7Drci3y6p6E8oi5TpUiG7NH3qSzcohPX9Xkvo';
const candidate = { qualified: true, score: 90, title: 'Example', suggestedSymbol: 'EXAMPLE' };
const tx = `0x${'1'.repeat(64)}`;
const token = `0x${'2'.repeat(40)}`;
const completed = {
  success: true, state: 'completed', transactionHash: tx,
  collectionToken: { address: token, creator: CONFIG.creatorAddress },
};

test('payload uses supported settings and an explicit fee recipient', () => {
  const p = buildFlaunchPayload(candidate, cid);
  assert.equal(p.sniperProtection, false);
  assert.equal(p.creatorFeeSplit, 8000);
  assert.equal(p.creatorAddress, CONFIG.creatorAddress);
  assert.equal(p.premineAmount, undefined);
});

for (const score of [undefined, NaN, 'bad', Infinity, 64]) {
  test(`reject invalid/unqualified score ${String(score)}`, () => {
    assert.throws(() => buildFlaunchPayload({ ...candidate, score }, cid));
  });
}
test('reject missing name, missing symbol and non-IPFS input', () => {
  assert.throws(() => buildFlaunchPayload({ ...candidate, title: '' }, cid));
  assert.throws(() => buildFlaunchPayload({ ...candidate, suggestedSymbol: '!!' }, cid));
  assert.throws(() => buildFlaunchPayload(candidate, 'https://example.com/image'));
  assert.throws(() => buildFlaunchPayload({ ...candidate, qualified: false }, cid));
});
test('normalize provider name and symbol limits', () => {
  const p = buildFlaunchPayload({ ...candidate, title: 'x'.repeat(80), suggestedSymbol: '123456789!' }, cid);
  assert.equal(p.name.length, 64);
  assert.equal(p.symbol, '12345678');
});

test('schedule at most 100 attempts per hour without catch-up bursts', () => {
  let previous = null;
  const slots = Array.from({ length: 100 }, () => (previous = nextLaunchAt(previous, 0)));
  assert.equal(slots[99], 3_564_000);
  assert.equal(nextLaunchAt(previous, 0), 3_600_000);
  assert.equal(nextLaunchAt(previous, 7_200_000), 7_200_000);
  assert.throws(() => nextLaunchAt(NaN, 0));
});
for (const rail of ['direct-clanker-v4', 'clanker-partner-api', 'flaunch', 'unknown']) {
  test(`unverified or paid rail ${rail} cannot silently execute`, () => {
    assert.throws(() => assertZeroCostRail(rail), /Launch blocked/);
  });
}
test('legacy launch entrypoints reject before reading files or credentials', () => {
  for (const file of ['direct-clanker.js', 'launcher.js']) {
    const child = spawnSync(process.execPath, [`src/${file}`], {
      encoding: 'utf8', env: { PATH: process.env.PATH, LIVE_LAUNCH_ENABLED: 'true', BATCH_FILE: '/nonexistent-batch' },
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /zero-cost\/two-stream policy/);
    assert.doesNotMatch(child.stderr, /ENOENT/);
  }
});

test('provider check is GET-only and never treats availability as full readiness', async () => {
  const calls = [];
  const data = await inspectFlaunch(async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, json: async () => url.endsWith('/livez')
      ? { status: 'ok', checks: { rpc: true, redis: true } }
      : { success: true, chains: [{ slug: 'base', chainId: 8453, capabilities: { serviceFundedLaunch: true } }] } };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(data.serviceFundedLaunch, true);
  assert.equal(data.productionEligible, false);
});
test('reject write paths and path injection before network access', async () => {
  let calls = 0;
  for (const path of ['/api/v1/base/launch-memecoin', '//evil.example', '/api/v1/launch-status/../config']) {
    await assert.rejects(readFlaunch(path, () => { calls++; }), /read-only/);
  }
  assert.equal(calls, 0);
});
test('HTTP and business failures are not successful checks', async () => {
  await assert.rejects(readFlaunch('/livez', async () => ({ ok: false, status: 429 })), /429/);
  await assert.rejects(readFlaunch('/livez', async () => ({ ok: true, json: async () => ({ success: false }) })), /unsuccessful/);
});
test('queued and failed jobs are never confirmed or automatically retried', () => {
  for (const data of [{ success: true, state: 'waiting' }, { success: true, state: 'failed', transactionHash: tx }, null]) {
    const job = classifyFlaunchJob(data, CONFIG.creatorAddress);
    assert.equal(job.confirmed, false);
    assert.equal(job.retrySafe, false);
  }
});
test('completed API status still requires independent chain checks', () => {
  const job = classifyFlaunchJob(completed, CONFIG.creatorAddress);
  assert.equal(job.state, 'awaiting-chain-verification');
  assert.equal(job.confirmed, false);
});
test('reject beneficiary mismatch or missing transaction hash', () => {
  assert.equal(classifyFlaunchJob(completed, token).state, 'invalid-result');
  assert.equal(classifyFlaunchJob({ ...completed, transactionHash: undefined }, CONFIG.creatorAddress).state, 'invalid-result');
});
const client = {
  getChainId: async () => 8453,
  getTransactionReceipt: async () => ({ status: 'success', transactionHash: tx, blockNumber: 1n }),
  getCode: async () => '0x1234',
};
test('reject chain mismatch', async () => {
  await assert.rejects(verifyFlaunchJob(completed, CONFIG.creatorAddress, { ...client, getChainId: async () => 1 }), /Wrong chain/);
});
test('reject a reverted transaction and an absent deployed contract', async () => {
  const reverted = await verifyFlaunchJob(completed, CONFIG.creatorAddress, {
    ...client, getTransactionReceipt: async () => ({ status: 'reverted', transactionHash: tx }),
  });
  assert.equal(reverted.state, 'reverted-or-invalid-receipt');
  const missing = await verifyFlaunchJob(completed, CONFIG.creatorAddress, { ...client, getCode: async () => '0x' });
  assert.equal(missing.state, 'missing-contract');
});
test('chain observation does not falsely attest economics or payout readiness', async () => {
  const observed = await verifyFlaunchJob(completed, CONFIG.creatorAddress, client);
  assert.equal(observed.chainObserved, true);
  assert.equal(observed.confirmed, false);
  assert.equal(observed.state, 'chain-observed-economics-unverified');
});
