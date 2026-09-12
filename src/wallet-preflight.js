import fs from 'node:fs/promises';
import path from 'node:path';

const INPUT = path.resolve('data/wallet-launch-bundle.json');
const OUTPUT = path.resolve('data/wallet-preflight.json');
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const BASE_CHAIN_ID = 8453;
// Public Base endpoints commonly reject bursts even when JSON-RPC batching is
// accepted. Simulate one deployment at a time and retry item-level rate limits.
const CHUNK = Number(process.env.PREFLIGHT_CHUNK_SIZE || 1);
const BETWEEN_CHUNKS_MS = Number(process.env.PREFLIGHT_DELAY_MS || 1100);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpcBatch(entries) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entries),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('Base RPC did not return a JSON-RPC batch');
      return body;
    } catch (err) {
      lastError = err;
      if (attempt < 4) await sleep(400 * attempt);
    }
  }
  throw lastError;
}

const isRateLimitError = item => /rate limit|too many requests|429/i.test(String(item?.error?.message || ''));

async function simulateChunk(entries) {
  let pending = entries;
  const final = new Map();
  for (let attempt = 1; attempt <= 6 && pending.length; attempt++) {
    const response = await rpcBatch(pending);
    const byId = new Map(response.map(item => [Number(item.id), item]));
    const retry = [];
    for (const request of pending) {
      const item = byId.get(Number(request.id));
      if (isRateLimitError(item) && attempt < 6) retry.push(request);
      else final.set(Number(request.id), item || { id: request.id, error: { message: 'missing JSON-RPC response' } });
    }
    pending = retry;
    if (pending.length) await sleep(Math.min(10_000, 1000 * (2 ** (attempt - 1))));
  }
  return [...final.values()];
}

async function main() {
  const bundle = JSON.parse(await fs.readFile(INPUT, 'utf8'));
  const calls = Array.isArray(bundle.calls) ? bundle.calls : [];
  if (Number(bundle.chainId) !== BASE_CHAIN_ID) throw new Error('Wallet bundle is not Base mainnet');
  if (calls.length !== 100 || Number(bundle.count) !== 100) throw new Error('Wallet bundle must contain exactly 100 calls');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(bundle.beneficiary || ''))) throw new Error('Invalid beneficiary');
  if (!calls.every(call => Number(call.chainId) === BASE_CHAIN_ID && call.value === '0x0')) throw new Error('Every call must be Base-only with zero ETH value');

  const results = [];
  for (let offset = 0; offset < calls.length; offset += CHUNK) {
    const slice = calls.slice(offset, offset + CHUNK);
    const request = slice.map((call, index) => ({
      jsonrpc: '2.0',
      id: offset + index + 1,
      method: 'eth_call',
      params: [{
        from: bundle.beneficiary,
        to: call.to,
        data: call.data,
        value: call.value
      }, 'pending']
    }));
    const response = await simulateChunk(request);
    const byId = new Map(response.map(item => [Number(item.id), item]));
    for (let index = 0; index < slice.length; index++) {
      const call = slice[index];
      const id = offset + index + 1;
      const item = byId.get(id);
      results.push({
        index: id - 1,
        name: call.name,
        symbol: call.symbol,
        expectedAddress: call.expectedAddress,
        success: Boolean(item && !item.error && typeof item.result === 'string'),
        error: item?.error ? String(item.error.message || JSON.stringify(item.error)).slice(0, 500) : null
      });
    }
    if (offset + CHUNK < calls.length) await sleep(BETWEEN_CHUNKS_MS);
  }

  const failed = results.filter(item => !item.success);
  const output = {
    checkedAt: new Date().toISOString(),
    batchId: bundle.batchId,
    chainId: BASE_CHAIN_ID,
    beneficiary: bundle.beneficiary,
    callCount: calls.length,
    simulatedCount: results.filter(item => item.success).length,
    failedCount: failed.length,
    allCallsSimulate: failed.length === 0,
    readyForUserAuthorization: failed.length === 0,
    results
  };
  await fs.writeFile(OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    batchId: output.batchId,
    callCount: output.callCount,
    simulatedCount: output.simulatedCount,
    failedCount: output.failedCount,
    readyForUserAuthorization: output.readyForUserAuthorization
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(async err => {
  const output = {
    checkedAt: new Date().toISOString(),
    readyForUserAuthorization: false,
    fatalError: String(err?.message || err).slice(0, 1000)
  };
  await fs.writeFile(OUTPUT, JSON.stringify(output, null, 2)).catch(() => {});
  console.error(err);
  process.exit(1);
});
