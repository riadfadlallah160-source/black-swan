import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, createWalletClient, formatUnits, http, isAddress, isHex, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { Clanker } from 'clanker-sdk/v4';
import { claimAirdrop } from 'clanker-sdk/v4/extensions';
import { CONFIG } from './config.js';

const LEDGER = path.resolve('data/live-tokens.json');
const FINANCE = path.resolve('data/finance-status.json');
const OUT = path.resolve('data/maintenance-results.json');
const PRIVATE_KEY = process.env.DIRECT_DEPLOYER_PRIVATE_KEY || '';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ENABLED = process.env.LIVE_MAINTENANCE_ENABLED === 'true';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MIN_CLAIM_USDC_RAW = parseUnits(process.env.MIN_CLAIM_USDC || '1', 6);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function wait(publicClient, txHash) {
  if (txHash) await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 120_000 });
}

async function main() {
  const output = { at: new Date().toISOString(), enabled: ENABLED, beneficiary: CONFIG.creatorAddress, feeClaim: null, founderClaims: [], errors: [] };
  if (!ENABLED) {
    output.blocked = 'LIVE_MAINTENANCE_ENABLED is not true';
    await fs.writeFile(OUT, JSON.stringify(output, null, 2));
    console.log(output.blocked);
    return;
  }
  if (!isHex(PRIVATE_KEY) || PRIVATE_KEY.length !== 66) throw new Error('DIRECT_DEPLOYER_PRIVATE_KEY is missing/invalid');

  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: base, transport: http(RPC_URL) });
  const clanker = new Clanker({ wallet, publicClient });
  const finance = await readJson(FINANCE, null);
  const ledger = await readJson(LEDGER, { tokens: [] });

  const claimableUsdcRaw = BigInt(finance?.feeStream?.claimableUsdcRaw || 0);
  if (claimableUsdcRaw >= MIN_CLAIM_USDC_RAW) {
    const claimed = await clanker.claimRewards({ token: BASE_USDC, rewardRecipient: CONFIG.creatorAddress });
    if (claimed.error) output.errors.push(`fee claim: ${String(claimed.error.message || claimed.error)}`);
    else {
      await wait(publicClient, claimed.txHash);
      output.feeClaim = { txHash: claimed.txHash, amountUsdc: formatUnits(claimableUsdcRaw, 6) };
    }
  }

  const byAddress = new Map((finance?.founderStream?.positions || []).map(p => [String(p.address || '').toLowerCase(), p]));
  for (const token of ledger.tokens || []) {
    if (!isAddress(token.address || '')) continue;
    const position = byAddress.get(token.address.toLowerCase());
    try {
      if (BigInt(position?.vaultClaimableRaw || 0) > 0n) {
        const claimed = await clanker.claimVaultedTokens({ token: token.address });
        if (claimed.error) throw claimed.error;
        await wait(publicClient, claimed.txHash);
        output.founderClaims.push({ token: token.address, type: 'vault', txHash: claimed.txHash });
      }
      if (BigInt(position?.airdropClaimableRaw || 0) > 0n && position?.airdropClaim) {
        const claimed = await claimAirdrop({
          clanker,
          token: token.address,
          recipient: position.airdropClaim.recipient,
          amount: BigInt(position.airdropClaim.allocatedAmount),
          proof: position.airdropClaim.proof,
        });
        if (claimed.error) throw claimed.error;
        await wait(publicClient, claimed.txHash);
        output.founderClaims.push({ token: token.address, type: 'airdrop', txHash: claimed.txHash });
      }
    } catch (err) {
      output.errors.push(`${token.address}: ${String(err?.message || err).slice(0, 600)}`);
    }
  }

  await fs.writeFile(OUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ feeClaimed: Boolean(output.feeClaim), founderClaims: output.founderClaims.length, errors: output.errors.length }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

main().catch(async err => {
  await fs.writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), enabled: ENABLED, fatalError: String(err?.message || err) }, null, 2)).catch(() => {});
  console.error(err);
  process.exit(1);
});
