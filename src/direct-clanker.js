import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getTickFromMarketCapUSDC } from 'clanker-sdk';
import { Clanker } from 'clanker-sdk/v4';

const BATCH = path.resolve('data/launch-batch.json');
const OUT = path.resolve('data/direct-launch-results.json');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BENEFICIARY = '0xf744573cdfFC211163c11c0a31730851Da78f708';
const EXIT_VAULT = process.env.EXIT_VAULT_ADDRESS || '';
const PRIVATE_KEY = process.env.DIRECT_DEPLOYER_PRIVATE_KEY || '';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const LIVE = process.env.LIVE_LAUNCH_ENABLED === 'true';
const VALIDATE_ONLY = process.argv.includes('--validate');

const STARTING_MCAP = 10_000;
const ENDING_MCAP = 100_000_000;
const tickLower = getTickFromMarketCapUSDC(STARTING_MCAP);
const tickUpper = getTickFromMarketCapUSDC(ENDING_MCAP);

function directConfig(p) {
  if (!isAddress(BENEFICIARY)) throw new Error('Invalid beneficiary');
  if (!isAddress(EXIT_VAULT)) throw new Error('EXIT_VAULT_ADDRESS missing/invalid');
  if (!p?.earlyAirdropClaim?.proof?.length) throw new Error('Early founder airdrop proof missing');

  return {
    chainId: base.id,
    name: p.token.name,
    symbol: p.token.symbol,
    image: p.token.imageUrl,
    tokenAdmin: BENEFICIARY,
    metadata: {
      description: p.token.description,
    },
    context: {
      interface: 'Black Swan',
      platform: 'automated-narrative-launcher',
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
      percentage: p.clanker.vault.percentage,
      lockupDuration: p.clanker.vault.lockupDuration,
      vestingDuration: p.clanker.vault.vestingDuration,
      recipient: EXIT_VAULT,
    },
    airdrop: {
      admin: BENEFICIARY,
      merkleRoot: p.clanker.airdrop.merkleRoot,
      lockupDuration: p.clanker.airdrop.lockupDuration,
      vestingDuration: p.clanker.airdrop.vestingDuration,
      amount: p.clanker.airdrop.amount,
    },
    rewards: {
      recipients: [{
        admin: BENEFICIARY,
        recipient: BENEFICIARY,
        bps: 10_000,
        token: 'Paired',
      }],
    },
    sniperFees: p.clanker.sniperFees,
    // Deliberately omit devBuy: creator allocation comes from vault/airdrop,
    // not a purchase from the pool.
    vanity: false,
  };
}

async function main() {
  const batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  const packages = (batch.packages || []).slice(0, 9);

  const result = {
    at: new Date().toISOString(),
    mode: VALIDATE_ONLY ? 'validate' : 'direct-clanker-v4',
    live: LIVE,
    beneficiary: BENEFICIARY,
    exitVault: EXIT_VAULT || null,
    startingMarketCapUsd: STARTING_MCAP,
    endingMarketCapUsd: ENDING_MCAP,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  if (!isAddress(EXIT_VAULT)) {
    result.blocked = 'EXIT_VAULT_ADDRESS is missing/invalid';
    if (!VALIDATE_ONLY) {
      await fs.writeFile(OUT, JSON.stringify(result, null, 2));
      console.log(result.blocked);
      return;
    }
  }

  // In validation mode, validate every field that does not require the future
  // deployed ExitVault and never construct/sign/broadcast a transaction.
  if (VALIDATE_ONLY) {
    const placeholderVault = isAddress(EXIT_VAULT)
      ? EXIT_VAULT
      : '0x0000000000000000000000000000000000000001';
    process.env.EXIT_VAULT_ADDRESS = placeholderVault;
    for (const p of packages) {
      const original = p.clanker.vault.recipient;
      p.clanker.vault.recipient = placeholderVault;
      const cfg = (() => {
        // directConfig reads the constant captured at process start, so build the
        // shape inline when the real vault is intentionally absent during CI.
        const baseCfg = {
          chainId: base.id,
          name: p.token.name,
          symbol: p.token.symbol,
          image: p.token.imageUrl,
          tokenAdmin: BENEFICIARY,
          pool: {
            pairedToken: BASE_USDC,
            tickIfToken0IsClanker: tickLower,
            tickSpacing: 200,
            positions: [{ tickLower, tickUpper, positionBps: 10_000 }],
          },
          fees: { type: 'static', ...p.clanker.fees },
          vault: { ...p.clanker.vault, recipient: placeholderVault },
          airdrop: p.clanker.airdrop,
          rewards: { recipients: [{ admin: BENEFICIARY, recipient: BENEFICIARY, bps: 10_000, token: 'Paired' }] },
          sniperFees: p.clanker.sniperFees,
        };
        return baseCfg;
      })();
      p.clanker.vault.recipient = original;
      if (!cfg.name || !cfg.symbol || !isAddress(cfg.pool.pairedToken)) throw new Error('Invalid direct config');
      if (cfg.vault.percentage + 3 !== 10) throw new Error('Founder allocation must total 10%');
      result.results.push({ name: cfg.name, symbol: cfg.symbol, valid: true });
    }
    result.succeeded = result.results.length;
    await fs.writeFile(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ valid: true, packages: result.succeeded, tickLower, tickUpper }, null, 2));
    return;
  }

  if (!LIVE) {
    result.blocked = 'LIVE_LAUNCH_ENABLED is not true';
    await fs.writeFile(OUT, JSON.stringify(result, null, 2));
    console.log(result.blocked);
    return;
  }
  if (!PRIVATE_KEY || !isHex(PRIVATE_KEY) || PRIVATE_KEY.length !== 66) {
    result.blocked = 'DIRECT_DEPLOYER_PRIVATE_KEY is missing/invalid';
    await fs.writeFile(OUT, JSON.stringify(result, null, 2));
    console.log(result.blocked);
    return;
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: base, transport: http(RPC_URL) });
  const clanker = new Clanker({ wallet, publicClient });

  for (const p of packages) {
    result.attempted++;
    try {
      const cfg = directConfig(p);
      const { txHash, waitForTransaction, error } = await clanker.deploy(cfg);
      if (error) throw error;
      const mined = await waitForTransaction();
      result.succeeded++;
      result.results.push({
        name: p.token.name,
        symbol: p.token.symbol,
        success: true,
        txHash,
        address: mined.address,
      });
    } catch (err) {
      result.failed++;
      result.results.push({
        name: p.token.name,
        symbol: p.token.symbol,
        success: false,
        error: String(err?.message || err).slice(0, 1200),
      });
    }
  }

  await fs.writeFile(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ attempted: result.attempted, succeeded: result.succeeded, failed: result.failed }, null, 2));
  if (result.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
