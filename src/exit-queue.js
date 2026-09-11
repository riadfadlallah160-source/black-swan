import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const FINANCE = path.resolve('data/finance-status.json');
const EXIT_BATCH = path.resolve('data/exit-batch.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function main() {
  const finance = await readJson(FINANCE, null);
  if (!finance) throw new Error('finance-status.json missing');
  const current = await readJson(EXIT_BATCH, null);
  const open = current && ['awaiting-authorization', 'authorized'].includes(current.status);
  if (open) {
    console.log(JSON.stringify({ id: current.id, status: current.status, count: current.count }, null, 2));
    return;
  }

  const positions = (finance?.founderStream?.positions || [])
    .filter(p => p?.eligibleForExitAuthorization)
    .map(p => ({
      token: p.address,
      name: p.name,
      symbol: p.symbol,
      founderBalance: p.founderBalance,
      nextTranche: p.nextTranche,
      nextMilestoneMultiple: p.nextMilestoneMultiple,
      nextTrancheAmount: p.nextTrancheAmount,
      minimumUsdcOut: p.minimumUsdcOut,
      currentMultiple: p.currentMultiple,
      liquidityUsd: p?.dex?.liquidityUsd || 0,
      volume24hUsd: p?.dex?.volume24hUsd || 0,
      marketCapUsd: p?.dex?.marketCapUsd || 0
    }));

  if (!positions.length) {
    console.log(JSON.stringify({ status: 'none-eligible', count: 0 }, null, 2));
    return;
  }

  const fingerprint = positions.map(p => `${p.token}:${p.nextTranche}`).join('|');
  const id = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 20);
  const batch = {
    id,
    createdAt: new Date().toISOString(),
    status: 'awaiting-authorization',
    count: positions.length,
    beneficiary: finance.beneficiary,
    exitVaultAddress: finance?.founderStream?.exitVaultAddress || null,
    positions,
    execution: {
      mode: 'human-authorized-founder-exit-batch',
      note: 'This batch records which staged ExitVault tranches meet the configured market-cap, liquidity and organic-volume rules. Authorization does not itself broadcast swaps.'
    }
  };
  await fs.writeFile(EXIT_BATCH, JSON.stringify(batch, null, 2));
  console.log(JSON.stringify({ id, status: batch.status, count: batch.count }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
