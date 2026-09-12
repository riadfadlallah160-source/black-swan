import fs from 'node:fs/promises';
import path from 'node:path';
import { assertZeroCostRail } from './launch-policy.js';

const BATCH = path.resolve(process.env.BATCH_FILE || 'data/approval-batch.json');
const OUT = path.resolve('data/launch-results.json');
const LIVE_TOKENS = path.resolve('data/live-tokens.json');
const API_KEY = process.env.CLANKER_API_KEY || '';
const LIVE = process.env.LIVE_LAUNCH_ENABLED === 'true';
const ENDPOINT = 'https://www.clanker.world/api/tokens/deploy';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const validAddress = x => /^0x[a-fA-F0-9]{40}$/.test(String(x || ''));
const validRoot = x => /^0x[a-fA-F0-9]{64}$/.test(String(x || ''));

function assertFullEconomics(p) {
  const beneficiary = p?.economics?.beneficiary;
  const founderRecipient = p?.economics?.founderRecipient || p?.clanker?.vault?.recipient;
  if (!validAddress(beneficiary)) throw new Error(`${p?.token?.symbol || 'package'} beneficiary missing/invalid`);
  if (!validAddress(founderRecipient)) throw new Error(`${p?.token?.symbol || 'package'} founder recipient missing/invalid`);
  if (p?.readiness !== 'launch-api-ready') throw new Error(`${p?.token?.symbol || 'package'} is not launch-api-ready`);
  if (!p?.clanker?.airdrop || !validRoot(p?.clanker?.airdrop?.merkleRoot)) throw new Error(`${p?.token?.symbol || 'package'} is missing the 3% early founder airdrop`);
  if (!p?.earlyAirdropClaim || !Array.isArray(p.earlyAirdropClaim.proof)) throw new Error(`${p?.token?.symbol || 'package'} founder airdrop claim missing`);
  if (String(p.earlyAirdropClaim.recipient || '').toLowerCase() !== founderRecipient.toLowerCase()) throw new Error(`${p?.token?.symbol || 'package'} early founder recipient mismatch`);
  if (Number(p?.clanker?.vault?.percentage) !== 7) throw new Error(`${p?.token?.symbol || 'package'} does not contain the 7% founder vault`);
  if (String(p?.clanker?.vault?.recipient || '').toLowerCase() !== founderRecipient.toLowerCase()) throw new Error(`${p?.token?.symbol || 'package'} founder vault recipient mismatch`);
  if (Number(p?.economics?.totalFounderAllocationPercentage) !== 10) throw new Error(`${p?.token?.symbol || 'package'} founder allocation is not 10%`);
  if (Number(p?.economics?.devBuyEth || 0) !== 0) throw new Error(`${p?.token?.symbol || 'package'} dev-buy must be zero`);
  const rewards = p?.clanker?.rewards || [];
  if (!rewards.length || String(rewards[0]?.recipient || '').toLowerCase() !== beneficiary.toLowerCase() || Number(rewards[0]?.allocation) !== 100) {
    throw new Error(`${p?.token?.symbol || 'package'} creator reward routing mismatch`);
  }
}

async function deploy(p) {
  assertFullEconomics(p);
  const body = structuredClone(p.clanker);
  body.token.image = p.token.imageUrl;
  body.token.tokenAdmin = p.economics.beneficiary;
  body.dryRun = false;
  delete body.endpoint;
  delete body.devBuy;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || data?.success === false) {
    throw new Error(`Clanker ${response.status}: ${JSON.stringify(data).slice(0, 900)}`);
  }
  return data;
}

async function readLiveTokens() {
  try {
    const parsed = JSON.parse(await fs.readFile(LIVE_TOKENS, 'utf8'));
    return Array.isArray(parsed.tokens) ? parsed : { tokens: [] };
  } catch {
    return { tokens: [] };
  }
}

async function main() {
  assertZeroCostRail('clanker-partner-api');
  const batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  const packages = batch.packages || [];
  const base = {
    at: new Date().toISOString(),
    live: LIVE,
    rail: 'clanker-partner-api',
    batchId: batch.id || null,
    batchStatus: batch.status || null,
    batchCount: packages.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    results: []
  };

  if (batch.status !== 'authorized') {
    base.blocked = `Frozen batch is ${batch.status || 'not authorized'}`;
    await fs.writeFile(OUT, JSON.stringify(base, null, 2));
    console.log(`Launcher blocked: ${base.blocked}`);
    return;
  }
  if (!LIVE) {
    base.blocked = 'LIVE_LAUNCH_ENABLED is not true';
    await fs.writeFile(OUT, JSON.stringify(base, null, 2));
    console.log(`Launcher blocked: ${base.blocked}`);
    return;
  }
  if (!API_KEY) {
    base.blocked = 'CLANKER_API_KEY is missing';
    await fs.writeFile(OUT, JSON.stringify(base, null, 2));
    console.log(`Launcher blocked: ${base.blocked}`);
    return;
  }
  if (packages.length !== 100) {
    base.blocked = `Authorized batch must contain exactly 100 packages; found ${packages.length}`;
    await fs.writeFile(OUT, JSON.stringify(base, null, 2));
    console.log(`Launcher blocked: ${base.blocked}`);
    return;
  }

  try {
    for (const p of packages) assertFullEconomics(p);
  } catch (e) {
    base.blocked = String(e?.message || e);
    await fs.writeFile(OUT, JSON.stringify(base, null, 2));
    console.log(`Launcher blocked: ${base.blocked}`);
    return;
  }

  // Provider-specific quotas must be verified before this path is enabled.
  for (let i = 0; i < packages.length; i += 2) {
    const group = packages.slice(i, i + 2);
    const settled = await Promise.allSettled(group.map(async p => ({ p, data: await deploy(p) })));
    for (const s of settled) {
      base.attempted++;
      if (s.status === 'fulfilled') {
        base.succeeded++;
        const { p, data } = s.value;
        base.results.push({
          name: p.token.name,
          symbol: p.token.symbol,
          narrative: p.narrative,
          success: true,
          expectedAddress: data.expectedAddress || data.address || data.contract_address || null,
          response: data
        });
      } else {
        base.failed++;
        base.results.push({ success: false, error: String(s.reason?.message || s.reason).slice(0, 1000) });
      }
    }
    if (i + 2 < packages.length) await sleep(1500);
  }

  await fs.writeFile(OUT, JSON.stringify(base, null, 2));
  const ledger = await readLiveTokens();
  const existing = new Map((ledger.tokens || []).map(t => [String(t.address || t.expectedAddress || '').toLowerCase(), t]));
  for (const r of base.results.filter(r => r.success && r.expectedAddress)) {
    existing.set(String(r.expectedAddress).toLowerCase(), {
      address: r.expectedAddress,
      name: r.name,
      symbol: r.symbol,
      narrative: r.narrative,
      batchId: batch.id,
      submittedAt: base.at,
      rail: base.rail
    });
  }
  await fs.writeFile(LIVE_TOKENS, JSON.stringify({ updatedAt: new Date().toISOString(), tokens: [...existing.values()] }, null, 2));

  console.log(JSON.stringify({ batchId: base.batchId, attempted: base.attempted, succeeded: base.succeeded, failed: base.failed }, null, 2));
  if (base.failed) process.exitCode = 1;
}

main().catch(async e => {
  console.error(e);
  process.exit(1);
});
