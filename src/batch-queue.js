import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const INPUT = path.resolve('data/launch-batch.json');
const POOL = path.resolve('data/approval-pool.json');
const BATCH = path.resolve('data/approval-batch.json');
const LIMIT = 100;

const keyOf = p => p?.clanker?.token?.requestKey || `${p?.token?.name || ''}|${p?.token?.symbol || ''}`.toLowerCase();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function main() {
  const incoming = await readJson(INPUT, { packages: [] });
  const pool = await readJson(POOL, { updatedAt: null, packages: [] });
  const current = await readJson(BATCH, null);

  const map = new Map();
  for (const p of pool.packages || []) map.set(keyOf(p), p);
  for (const p of incoming.packages || []) {
    const key = keyOf(p);
    if (!key || map.has(key)) continue;
    map.set(key, { ...p, queuedAt: new Date().toISOString() });
  }

  let waiting = [...map.values()].slice(0, 500);
  let frozen = current;
  const batchOpen = frozen && ['awaiting-authorization', 'authorized'].includes(frozen.status);

  if (!batchOpen && waiting.length >= LIMIT) {
    const packages = waiting.slice(0, LIMIT);
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
        devBuyEth: 0
      },
      packages,
      execution: {
        mode: 'human-authorized-batch',
        note: 'Authorization freezes this batch. Financial broadcast remains a separate execution step.'
      }
    };
    const selected = new Set(packages.map(keyOf));
    waiting = waiting.filter(p => !selected.has(keyOf(p)));
  }

  await fs.writeFile(POOL, JSON.stringify({ updatedAt: new Date().toISOString(), count: waiting.length, packages: waiting }, null, 2));
  if (frozen) await fs.writeFile(BATCH, JSON.stringify(frozen, null, 2));

  console.log(JSON.stringify({
    poolCount: waiting.length,
    batchId: frozen?.id || null,
    batchCount: frozen?.count || 0,
    batchStatus: frozen?.status || 'building'
  }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
