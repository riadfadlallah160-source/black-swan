import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

const INPUT = path.resolve('data/launch-batch.json');
const POOL = path.resolve('data/approval-pool.json');
const BATCH = path.resolve('data/approval-batch.json');
const BATCH_HISTORY = path.resolve('data/batch-history.json');
const WALLET_BUNDLE = path.resolve('data/wallet-launch-bundle.json');
const LIMIT = 100;
const TOTAL_SUPPLY_TOKENS = 100_000_000_000n;
const EARLY_PERCENT = 3n;
const EARLY_LOCK_SECONDS = 24 * 60 * 60;
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const keyOf = p => p?.clanker?.token?.requestKey || `${p?.token?.name || ''}|${p?.token?.symbol || ''}`.toLowerCase();
const validAddress = s => /^0x[a-fA-F0-9]{40}$/.test(String(s || ''));
const hasAirdropClaim = p => Boolean(
  p?.earlyAirdropClaim &&
  validAddress(p.earlyAirdropClaim.recipient) &&
  Array.isArray(p.earlyAirdropClaim.proof) &&
  /^0x[a-fA-F0-9]{64}$/.test(String(p?.clanker?.airdrop?.merkleRoot || ''))
);
const isLaunchReady = p => Boolean(
  p?.readiness === 'launch-api-ready' &&
  hasAirdropClaim(p) &&
  Number(p?.clanker?.vault?.percentage) === 7 &&
  p?.clanker?.airdrop &&
  Number(p?.economics?.totalFounderAllocationPercentage) === 10 &&
  Number(p?.economics?.devBuyEth || 0) === 0
);

function armFounderCustody(p) {
  if (isLaunchReady(p)) return p;
  const recipient = p?.economics?.beneficiary || p?.clanker?.token?.tokenAdmin;
  if (!validAddress(recipient) || Number(p?.clanker?.vault?.percentage) !== 7) return p;
  const amountTokens = Number((TOTAL_SUPPLY_TOKENS * EARLY_PERCENT) / 100n);
  const amountWei = (BigInt(amountTokens) * 10n ** 18n).toString();
  const tree = StandardMerkleTree.of([[recipient, amountWei]], ['address', 'uint256']);
  tree.validate();
  const airdrop = {
    admin: recipient,
    merkleRoot: tree.root,
    lockupDuration: EARLY_LOCK_SECONDS,
    vestingDuration: 0,
    amount: amountTokens
  };
  const claim = {
    recipient,
    allocatedAmount: amountWei,
    proof: tree.getProof(0),
    tree: tree.dump()
  };
  return {
    ...p,
    economics: {
      ...(p.economics || {}),
      stream1: 'Creator LP rewards in Base USDC to beneficiary',
      stream2: '3% founder allocation after 1 day + 7% after 7 days',
      totalFounderAllocationPercentage: 10,
      devBuyEth: 0,
      beneficiary: recipient,
      founderRecipient: recipient,
      founderCustody: 'beneficiary-wallet',
      exitVaultReady: false
    },
    earlyAirdropClaim: claim,
    clanker: {
      ...p.clanker,
      rewards: [{ recipient, admin: recipient, allocation: 100, rewardsToken: 'Paired' }],
      vault: { ...p.clanker.vault, recipient },
      airdrop
    },
    readiness: 'launch-api-ready'
  };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function deployedBundleFor(current) {
  if (!current?.id) return null;
  const bundle = await readJson(WALLET_BUNDLE, null);
  if (!bundle || bundle.batchId !== current.id || !Array.isArray(bundle.calls) || bundle.calls.length !== LIMIT) return null;
  if (!bundle.calls.every(call => validAddress(call?.expectedAddress))) return null;

  const payload = bundle.calls.map((call, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: 'eth_getCode',
    params: [call.expectedAddress, 'latest']
  }));
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Base RPC returned ${response.status}`);
  const results = await response.json();
  if (!Array.isArray(results)) throw new Error('Base RPC did not return a batch response');
  const byId = new Map(results.map(item => [Number(item.id), item]));
  const deployed = bundle.calls.map((call, index) => {
    const item = byId.get(index + 1);
    const code = typeof item?.result === 'string' ? item.result : '0x';
    return {
      index,
      address: call.expectedAddress,
      name: call.name,
      symbol: call.symbol,
      narrative: call.narrative,
      deployed: code !== '0x' && code !== '0x0'
    };
  });
  return { bundle, deployed, complete: deployed.every(item => item.deployed) };
}

async function main() {
  const incoming = await readJson(INPUT, { packages: [] });
  const pool = await readJson(POOL, { updatedAt: null, packages: [] });
  let current = await readJson(BATCH, null);
  const history = await readJson(BATCH_HISTORY, { updatedAt: null, batches: [] });

  if (current && ['awaiting-authorization', 'authorized'].includes(current.status)) {
    try {
      const chainState = await deployedBundleFor(current);
      if (chainState?.complete) {
        const completedAt = new Date().toISOString();
        const completed = {
          ...current,
          status: 'confirmed-onchain',
          completedAt,
          deployedTokens: chainState.deployed.map(item => ({
            index: item.index,
            address: item.address,
            name: item.name,
            symbol: item.symbol,
            narrative: item.narrative
          }))
        };
        const batches = Array.isArray(history.batches) ? history.batches.filter(item => item?.id !== completed.id) : [];
        batches.unshift(completed);
        history.updatedAt = completedAt;
        history.batches = batches.slice(0, 50);
        await fs.writeFile(BATCH_HISTORY, JSON.stringify(history, null, 2));
        await fs.rm(BATCH, { force: true });
        current = null;
      }
    } catch (err) {
      console.warn(`Base completion check skipped: ${String(err?.message || err).slice(0, 300)}`);
    }
  }

  const map = new Map();
  for (const p of pool.packages || []) map.set(keyOf(p), armFounderCustody(p));
  for (const p of incoming.packages || []) {
    const armed = armFounderCustody(p);
    const key = keyOf(armed);
    if (!key) continue;
    if (map.has(key)) {
      const existing = map.get(key);
      if (!isLaunchReady(existing) && isLaunchReady(armed)) map.set(key, { ...armed, queuedAt: existing?.queuedAt || new Date().toISOString() });
      continue;
    }
    map.set(key, { ...armed, queuedAt: new Date().toISOString() });
  }

  let waiting = [...map.values()].slice(0, 500);
  let frozen = current;
  const batchOpen = frozen && ['awaiting-authorization', 'authorized'].includes(frozen.status);
  const ready = waiting.filter(isLaunchReady);

  if (!batchOpen && ready.length >= LIMIT) {
    const packages = ready.slice(0, LIMIT);
    const fingerprint = packages.map(keyOf).join('|');
    const id = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 20);
    frozen = {
      id,
      createdAt: new Date().toISOString(),
      status: 'awaiting-authorization',
      count: packages.length,
      beneficiary: incoming.beneficiary,
      issuanceRail: incoming.issuanceRail,
      economics: {
        founderAllocation: '10% total: 3% after 1 day + 7% after 7 days',
        creatorRewards: 'paired-asset creator rewards to beneficiary',
        founderCustody: 'beneficiary wallet',
        devBuyEth: 0
      },
      validation: {
        fullEconomicsRequired: true,
        allPackagesLaunchReady: packages.every(isLaunchReady)
      },
      packages,
      execution: {
        mode: 'wallet-authorized-batch',
        note: 'The wallet authorizes the encoded Base deployment calls. Completion is verified independently from Base contract code before the next batch rotates in.'
      }
    };
    const selected = new Set(packages.map(keyOf));
    waiting = waiting.filter(p => !selected.has(keyOf(p)));
  }

  const readyCount = waiting.filter(isLaunchReady).length;
  const pendingInfrastructureCount = waiting.length - readyCount;
  await fs.writeFile(POOL, JSON.stringify({
    updatedAt: new Date().toISOString(),
    count: waiting.length,
    readyCount,
    pendingInfrastructureCount,
    target: LIMIT,
    packages: waiting
  }, null, 2));
  if (frozen) await fs.writeFile(BATCH, JSON.stringify(frozen, null, 2));

  console.log(JSON.stringify({
    poolCount: waiting.length,
    launchReadyCount: readyCount,
    pendingInfrastructureCount,
    batchId: frozen?.id || null,
    batchCount: frozen?.count || 0,
    batchStatus: frozen?.status || 'building',
    completedBatches: Array.isArray(history.batches) ? history.batches.length : 0
  }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });