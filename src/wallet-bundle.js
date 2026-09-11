import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeFunctionData, isAddress } from 'viem';
import { base } from 'viem/chains';
import { getTickFromMarketCapUSDC } from 'clanker-sdk';
import { Clanker } from 'clanker-sdk/v4';

const BATCH = path.resolve('data/approval-batch.json');
const OUT = path.resolve('data/wallet-launch-bundle.json');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BENEFICIARY = '0xf744573cdfFC211163c11c0a31730851Da78f708';
const STARTING_MCAP = 10_000;
const ENDING_MCAP = 100_000_000;
const tickLower = getTickFromMarketCapUSDC(STARTING_MCAP);
const tickUpper = getTickFromMarketCapUSDC(ENDING_MCAP);

function founderRecipient(p) {
  const recipient = p?.economics?.founderRecipient || p?.clanker?.vault?.recipient || BENEFICIARY;
  if (!isAddress(recipient)) throw new Error(`Invalid founder recipient for ${p?.token?.symbol || 'token'}`);
  return recipient;
}

function configFor(p) {
  if (!p?.earlyAirdropClaim || !Array.isArray(p.earlyAirdropClaim.proof)) {
    throw new Error(`Missing founder airdrop claim for ${p?.token?.symbol || 'token'}`);
  }
  const recipient = founderRecipient(p);
  return {
    chainId: base.id,
    name: p.token.name,
    symbol: p.token.symbol,
    image: p.token.imageUrl,
    tokenAdmin: BENEFICIARY,
    metadata: { description: p.token.description },
    context: {
      interface: 'Black Swan',
      platform: 'human-authorized-batch',
      messageId: p.clanker.token.requestKey,
      id: p.narrative,
    },
    pool: {
      pairedToken: BASE_USDC,
      tickIfToken0IsClanker: tickLower,
      tickSpacing: 200,
      positions: [{ tickLower, tickUpper, positionBps: 10_000 }],
    },
    fees: {
      type: 'static',
      clankerFee: p.clanker.fees.clankerFee,
      pairedFee: p.clanker.fees.pairedFee,
    },
    vault: {
      percentage: 7,
      lockupDuration: p.clanker.vault.lockupDuration,
      vestingDuration: p.clanker.vault.vestingDuration,
      recipient,
    },
    airdrop: {
      admin: p.clanker.airdrop.admin || BENEFICIARY,
      merkleRoot: p.clanker.airdrop.merkleRoot,
      lockupDuration: p.clanker.airdrop.lockupDuration,
      vestingDuration: p.clanker.airdrop.vestingDuration,
      amount: p.clanker.airdrop.amount,
    },
    rewards: {
      recipients: [{ admin: BENEFICIARY, recipient: BENEFICIARY, bps: 10_000, token: 'Paired' }],
    },
    sniperFees: p.clanker.sniperFees,
    vanity: false,
  };
}

async function main() {
  let batch;
  try {
    batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  } catch {
    await fs.rm(OUT, { force: true });
    console.log('No frozen batch exists; stale wallet bundle cleared.');
    return;
  }
  if (!batch?.id || !Array.isArray(batch.packages) || batch.packages.length !== 100) {
    throw new Error('Frozen batch must contain exactly 100 packages.');
  }
  if (!batch?.validation?.allPackagesLaunchReady) {
    throw new Error('Frozen batch has not passed full-economics validation.');
  }

  const clanker = new Clanker();
  const calls = [];
  for (const p of batch.packages) {
    const tx = await clanker.getDeployTransaction(configFor(p));
    const data = encodeFunctionData({ abi: tx.abi, functionName: tx.functionName, args: tx.args });
    calls.push({
      name: p.token.name,
      symbol: p.token.symbol,
      narrative: p.narrative,
      score: p.score,
      to: tx.address,
      data,
      value: `0x${BigInt(tx.value || 0n).toString(16)}`,
      chainId: Number(tx.chainId),
      expectedAddress: tx.expectedAddress,
      beneficiary: BENEFICIARY,
      founderRecipient: founderRecipient(p),
      creatorRewardBps: 10_000,
      founderAllocationPercentage: 10,
      devBuyEth: 0,
    });
  }

  const uniqueExpected = new Set(calls.map(x => String(x.expectedAddress).toLowerCase()));
  if (uniqueExpected.size !== calls.length) throw new Error('Expected token address collision detected.');
  if (!calls.every(x => x.chainId === base.id && x.value === '0x0')) {
    throw new Error('Bundle must be Base-only and zero dev-buy.');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    batchId: batch.id,
    batchStatus: batch.status,
    chainId: base.id,
    beneficiary: BENEFICIARY,
    count: calls.length,
    mode: 'unsigned-user-authorized-wallet-calls',
    instruction: 'Each entry is a fully encoded Clanker V4 deployToken call. A compatible wallet or smart account must authorize and broadcast the calls.',
    calls,
  };
  await fs.writeFile(OUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ batchId: batch.id, calls: calls.length, chainId: base.id, zeroValueCalls: calls.filter(x => x.value === '0x0').length }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });