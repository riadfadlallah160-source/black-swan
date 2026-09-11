import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, formatUnits, http, isAddress } from 'viem';
import { base } from 'viem/chains';
import { Clanker } from 'clanker-sdk/v4';
import { CONFIG } from './config.js';

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CLANKER_AIRDROP = '0xf652B3610D75D81871bf96DB50825d9af28391E0';
const BENEFICIARY = CONFIG.creatorAddress;
const EXIT_VAULT = process.env.EXIT_VAULT_ADDRESS || '';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const OUT = path.resolve('data/finance-status.json');
const LEDGER = path.resolve('data/live-tokens.json');
const BATCH_HISTORY = path.resolve('data/batch-history.json');

const erc20Abi = [
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'account',type:'address'}], outputs:[{name:'',type:'uint256'}] },
  { type:'function', name:'decimals', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint8'}] }
];
const airdropAbi = [
  { type:'function', name:'amountAvailableToClaim', stateMutability:'view', inputs:[{name:'token',type:'address'},{name:'recipient',type:'address'},{name:'allocatedAmount',type:'uint256'}], outputs:[{name:'',type:'uint256'}] }
];
const exitVaultAbi = [
  { type:'function', name:'nextTranche', stateMutability:'view', inputs:[{name:'token',type:'address'}], outputs:[{name:'',type:'uint8'}] },
  { type:'function', name:'trancheAmount', stateMutability:'view', inputs:[{name:'token',type:'address'}], outputs:[{name:'',type:'uint256'}] },
  { type:'function', name:'minimumUsdcOut', stateMutability:'view', inputs:[{name:'token',type:'address'}], outputs:[{name:'',type:'uint256'}] }
];

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function extractSuccesses(result) {
  return (result?.results || [])
    .filter(x => x?.success && isAddress(x.address || x.expectedAddress || ''))
    .map(x => ({
      address: x.address || x.expectedAddress,
      name: x.name || null,
      symbol: x.symbol || null,
      txHash: x.txHash || null,
      firstSeenAt: result.at || new Date().toISOString(),
      source: 'launcher-result'
    }));
}

function extractHistorySuccesses(history) {
  const rows = [];
  for (const batch of history?.batches || []) {
    if (batch?.status !== 'confirmed-onchain') continue;
    for (const deployed of batch?.deployedTokens || []) {
      if (!isAddress(deployed?.address || '')) continue;
      rows.push({
        address: deployed.address,
        name: deployed.name || null,
        symbol: deployed.symbol || null,
        txHash: null,
        firstSeenAt: batch.completedAt || batch.createdAt || new Date().toISOString(),
        source: 'wallet-batch-confirmed',
        batchId: batch.id,
        packageIndex: Number(deployed.index)
      });
    }
  }
  return rows;
}

function packageLookup(history) {
  const map = new Map();
  for (const batch of history?.batches || []) {
    for (const deployed of batch?.deployedTokens || []) {
      const address = String(deployed?.address || '').toLowerCase();
      const p = batch?.packages?.[Number(deployed?.index)];
      if (address && p) map.set(address, p);
    }
  }
  return map;
}

async function updateLedger(history) {
  const current = await readJson(LEDGER, { tokens: [] });
  const api = await readJson(path.resolve('data/launch-results.json'), null);
  const direct = await readJson(path.resolve('data/direct-launch-results.json'), null);
  const map = new Map((current.tokens || []).map(x => [String(x.address).toLowerCase(), x]));
  for (const x of [...extractSuccesses(api), ...extractSuccesses(direct), ...extractHistorySuccesses(history)]) {
    const key = x.address.toLowerCase();
    if (!map.has(key)) map.set(key, x);
  }
  const ledger = { updatedAt: new Date().toISOString(), count: map.size, tokens: [...map.values()] };
  await fs.writeFile(LEDGER, JSON.stringify(ledger, null, 2));
  return ledger;
}

async function dexSnapshot(token) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const pairs = (data?.pairs || []).filter(p => p?.chainId === 'base');
    const best = pairs.sort((a,b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
    if (!best) return null;
    return {
      pairAddress: best.pairAddress || null,
      marketCapUsd: Number(best.marketCap || best.fdv || 0),
      liquidityUsd: Number(best.liquidity?.usd || 0),
      volume24hUsd: Number(best.volume?.h24 || 0),
      priceUsd: Number(best.priceUsd || 0)
    };
  } catch { return null; }
}

async function main() {
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const clanker = new Clanker({ publicClient });
  const history = await readJson(BATCH_HISTORY, { batches: [] });
  const packagesByAddress = packageLookup(history);
  const ledger = await updateLedger(history);
  let claimableUsdcRaw = 0n;
  let feeError = null;
  try {
    claimableUsdcRaw = await clanker.availableRewards({ token: BASE_USDC, rewardRecipient: BENEFICIARY });
  } catch (e) { feeError = String(e?.message || e).slice(0,600); }

  const positions = [];
  for (const token of ledger.tokens.slice(0,100)) {
    let beneficiaryBalanceRaw = 0n;
    let exitVaultBalanceRaw = 0n;
    let vaultClaimableRaw = 0n;
    let airdropClaimableRaw = 0n;
    let decimals = 18;
    let nextTranche = null;
    let trancheAmountRaw = null;
    let minimumUsdcOutRaw = null;
    let monitorError = null;
    const p = packagesByAddress.get(String(token.address).toLowerCase());
    const airdropClaim = p?.earlyAirdropClaim && Array.isArray(p.earlyAirdropClaim.proof)
      ? {
          recipient: p.earlyAirdropClaim.recipient,
          allocatedAmount: String(p.earlyAirdropClaim.allocatedAmount),
          proof: p.earlyAirdropClaim.proof
        }
      : null;

    try {
      decimals = Number(await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName:'decimals' }));
      beneficiaryBalanceRaw = await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName:'balanceOf', args:[BENEFICIARY] });
      vaultClaimableRaw = await clanker.getVaultClaimableAmount({ token: token.address });
      if (airdropClaim?.allocatedAmount && isAddress(airdropClaim.recipient || '')) {
        airdropClaimableRaw = await publicClient.readContract({
          address: CLANKER_AIRDROP,
          abi: airdropAbi,
          functionName:'amountAvailableToClaim',
          args:[token.address, airdropClaim.recipient, BigInt(airdropClaim.allocatedAmount)]
        });
      }
      if (isAddress(EXIT_VAULT)) {
        [exitVaultBalanceRaw, nextTranche, trancheAmountRaw, minimumUsdcOutRaw] = await Promise.all([
          publicClient.readContract({ address: token.address, abi: erc20Abi, functionName:'balanceOf', args:[EXIT_VAULT] }),
          publicClient.readContract({ address: EXIT_VAULT, abi: exitVaultAbi, functionName:'nextTranche', args:[token.address] }),
          publicClient.readContract({ address: EXIT_VAULT, abi: exitVaultAbi, functionName:'trancheAmount', args:[token.address] }),
          publicClient.readContract({ address: EXIT_VAULT, abi: exitVaultAbi, functionName:'minimumUsdcOut', args:[token.address] })
        ]);
      }
    } catch (e) { monitorError = String(e?.message || e).slice(0,500); }

    const dex = await dexSnapshot(token.address);
    const i = nextTranche === null ? null : Number(nextTranche);
    const milestone = i === null ? null : CONFIG.exitPolicy.milestones[i] || null;
    const initialMarketCap = CONFIG.clanker.initialMarketCapUsdc;
    const multiple = dex?.marketCapUsd ? dex.marketCapUsd / initialMarketCap : 0;
    const eligible = Boolean(
      isAddress(EXIT_VAULT) && milestone && exitVaultBalanceRaw > 0n &&
      multiple >= milestone.multiple &&
      Number(dex?.liquidityUsd || 0) >= CONFIG.exitPolicy.minLiquidityUsd &&
      Number(dex?.volume24hUsd || 0) >= CONFIG.exitPolicy.min24hOrganicVolumeUsd
    );

    positions.push({
      ...token,
      founderBalance: formatUnits(beneficiaryBalanceRaw, decimals),
      founderBalanceRaw: beneficiaryBalanceRaw.toString(),
      vaultClaimable: formatUnits(vaultClaimableRaw, decimals),
      vaultClaimableRaw: vaultClaimableRaw.toString(),
      airdropClaimable: formatUnits(airdropClaimableRaw, decimals),
      airdropClaimableRaw: airdropClaimableRaw.toString(),
      airdropClaim,
      nextTranche: i,
      nextMilestoneMultiple: milestone?.multiple || null,
      nextTrancheAmount: trancheAmountRaw ? formatUnits(trancheAmountRaw, decimals) : null,
      minimumUsdcOut: minimumUsdcOutRaw ? formatUnits(minimumUsdcOutRaw, 6) : null,
      currentMultiple: Number(multiple.toFixed(3)),
      dex,
      eligibleForExitAuthorization: eligible,
      monitorError
    });
  }

  const claimableFounderPositions = positions.filter(x => BigInt(x.vaultClaimableRaw || '0') > 0n || BigInt(x.airdropClaimableRaw || '0') > 0n).length;
  const status = {
    updatedAt: new Date().toISOString(),
    beneficiary: BENEFICIARY,
    baseUsdc: BASE_USDC,
    feeStream: {
      mode: 'Clanker FeeLocker paired-asset rewards',
      claimableUsdc: formatUnits(claimableUsdcRaw, 6),
      claimableUsdcRaw: claimableUsdcRaw.toString(),
      permissionlessClaim: true,
      payoutRecipient: BENEFICIARY,
      walletClaimArmed: true,
      automaticClaimExecutorArmed: false,
      error: feeError
    },
    founderStream: {
      custody: 'beneficiary-wallet',
      exitVaultAddress: isAddress(EXIT_VAULT) ? EXIT_VAULT : null,
      exitVaultDeployedAndConfigured: isAddress(EXIT_VAULT),
      liveTokenCount: ledger.count,
      claimableFounderPositionCount: claimableFounderPositions,
      eligibleExitCount: positions.filter(x => x.eligibleForExitAuthorization).length,
      positions
    }
  };
  await fs.writeFile(OUT, JSON.stringify(status, null, 2));
  console.log(JSON.stringify({
    claimableUsdc: status.feeStream.claimableUsdc,
    liveTokens: ledger.count,
    founderClaimsReady: claimableFounderPositions,
    eligibleExits: status.founderStream.eligibleExitCount,
    exitVaultReady: status.founderStream.exitVaultDeployedAndConfigured
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });