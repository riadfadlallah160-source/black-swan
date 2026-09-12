import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, isAddress, isHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getTickFromMarketCapUSDC } from 'clanker-sdk';
import { Clanker } from 'clanker-sdk/v4';
import { assertZeroCostRail } from './launch-policy.js';

const BATCH = path.resolve(process.env.BATCH_FILE || 'data/approval-batch.json');
const OUT = path.resolve('data/direct-launch-results.json');
const LIVE_TOKENS = path.resolve('data/live-tokens.json');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BENEFICIARY = '0xf744573cdfFC211163c11c0a31730851Da78f708';
const PRIVATE_KEY = process.env.DIRECT_DEPLOYER_PRIVATE_KEY || '';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const LIVE = process.env.LIVE_LAUNCH_ENABLED === 'true';
const VALIDATE_ONLY = process.argv.includes('--validate');
const STARTING_MCAP = 10_000;
const ENDING_MCAP = 100_000_000;
const tickLower = getTickFromMarketCapUSDC(STARTING_MCAP);
const tickUpper = getTickFromMarketCapUSDC(ENDING_MCAP);

function founderRecipient(p) {
  const recipient = p?.economics?.founderRecipient || p?.clanker?.vault?.recipient || BENEFICIARY;
  if (!isAddress(recipient)) throw new Error('Founder recipient missing/invalid');
  return recipient;
}
function directConfig(p) {
  if (!p?.earlyAirdropClaim || !Array.isArray(p.earlyAirdropClaim.proof)) throw new Error('Early founder airdrop claim missing');
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(p?.clanker?.airdrop?.merkleRoot || ''))) throw new Error('Early founder airdrop config missing');
  const recipient = founderRecipient(p);
  if (String(p.earlyAirdropClaim.recipient || '').toLowerCase() !== recipient.toLowerCase()) throw new Error('Early founder allocation recipient mismatch');
  if (Number(p?.clanker?.vault?.percentage) !== 7) throw new Error('Founder vault must be 7%');
  if (Number(p?.economics?.totalFounderAllocationPercentage) !== 10) throw new Error('Founder allocation must total 10%');
  if (Number(p?.economics?.devBuyEth || 0) !== 0) throw new Error('Dev buy must be zero');
  return {
    chainId: base.id,
    name: p.token.name,
    symbol: p.token.symbol,
    image: p.token.imageUrl,
    tokenAdmin: BENEFICIARY,
    metadata: { description: p.token.description },
    context: { interface: 'Black Swan', platform: 'authorized-batch-launcher', messageId: p.clanker.token.requestKey, id: p.narrative },
    pool: { pairedToken: BASE_USDC, tickIfToken0IsClanker: tickLower, tickSpacing: 200, positions: [{ tickLower, tickUpper, positionBps: 10_000 }] },
    fees: { type: 'static', clankerFee: p.clanker.fees.clankerFee, pairedFee: p.clanker.fees.pairedFee },
    vault: { percentage: 7, lockupDuration: p.clanker.vault.lockupDuration, vestingDuration: p.clanker.vault.vestingDuration, recipient },
    airdrop: { admin: p.clanker.airdrop.admin || BENEFICIARY, merkleRoot: p.clanker.airdrop.merkleRoot, lockupDuration: p.clanker.airdrop.lockupDuration, vestingDuration: p.clanker.airdrop.vestingDuration, amount: p.clanker.airdrop.amount },
    rewards: { recipients: [{ admin: BENEFICIARY, recipient: BENEFICIARY, bps: 10_000, token: 'Paired' }] },
    sniperFees: p.clanker.sniperFees,
    vanity: false,
  };
}
async function readLedger() { try { const x=JSON.parse(await fs.readFile(LIVE_TOKENS,'utf8')); return Array.isArray(x.tokens)?x:{tokens:[]}; } catch { return {tokens:[]}; } }

async function alreadyDeployed(publicClient, address) {
  if (!isAddress(address)) return false;
  const code = await publicClient.getCode({ address });
  return Boolean(code && code !== '0x' && code !== '0x0');
}

async function main() {
  if (!VALIDATE_ONLY) assertZeroCostRail('direct-clanker-v4');
  const batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  const packages = batch.packages || [];
  const result = { at:new Date().toISOString(), mode:VALIDATE_ONLY?'validate':'direct-clanker-v4', live:LIVE, batchId:batch.id||null, beneficiary:BENEFICIARY, attempted:0, succeeded:0, failed:0, results:[] };

  if (VALIDATE_ONLY) {
    for (const p of packages) { const cfg=directConfig(p); result.results.push({name:cfg.name,symbol:cfg.symbol,founderRecipient:cfg.vault.recipient,valid:true}); }
    result.succeeded=result.results.length;
    await fs.writeFile(OUT,JSON.stringify(result,null,2));
    console.log(JSON.stringify({valid:true,packages:result.succeeded,beneficiary:BENEFICIARY,tickLower,tickUpper},null,2));
    return;
  }
  if (batch.status !== 'authorized') throw new Error(`Frozen batch must be authorized; current status ${batch.status}`);
  if (packages.length !== 100) throw new Error(`Authorized batch must contain exactly 100 packages; found ${packages.length}`);
  if (!LIVE) throw new Error('LIVE_LAUNCH_ENABLED is not true');
  if (!PRIVATE_KEY || !isHex(PRIVATE_KEY) || PRIVATE_KEY.length !== 66) throw new Error('DIRECT_DEPLOYER_PRIVATE_KEY is missing/invalid');
  for (const p of packages) directConfig(p);

  const account=privateKeyToAccount(PRIVATE_KEY);
  const publicClient=createPublicClient({chain:base,transport:http(RPC_URL)});
  const wallet=createWalletClient({account,chain:base,transport:http(RPC_URL)});
  const clanker=new Clanker({wallet,publicClient});
  for (const p of packages) {
    result.attempted++;
    try {
      const cfg=directConfig(p);
      const prepared = await clanker.getDeployTransaction(cfg);
      if (await alreadyDeployed(publicClient, prepared.expectedAddress)) {
        result.succeeded++;
        result.results.push({name:p.token.name,symbol:p.token.symbol,narrative:p.narrative,founderRecipient:cfg.vault.recipient,success:true,alreadyDeployed:true,address:prepared.expectedAddress});
        continue;
      }
      const {txHash,waitForTransaction,error}=await clanker.deploy(cfg);
      if (error) throw error;
      const mined=await waitForTransaction();
      result.succeeded++;
      result.results.push({name:p.token.name,symbol:p.token.symbol,narrative:p.narrative,founderRecipient:cfg.vault.recipient,success:true,txHash,address:mined.address});
    } catch(err) {
      result.failed++;
      result.results.push({name:p.token.name,symbol:p.token.symbol,success:false,error:String(err?.message||err).slice(0,1200)});
    }
  }
  await fs.writeFile(OUT,JSON.stringify(result,null,2));
  const ledger=await readLedger();
  const map=new Map((ledger.tokens||[]).map(t=>[String(t.address||'').toLowerCase(),t]));
  for(const r of result.results.filter(r=>r.success&&r.address)) map.set(String(r.address).toLowerCase(),{address:r.address,name:r.name,symbol:r.symbol,narrative:r.narrative,batchId:batch.id,submittedAt:result.at,rail:'direct-clanker-v4'});
  await fs.writeFile(LIVE_TOKENS,JSON.stringify({updatedAt:new Date().toISOString(),tokens:[...map.values()]},null,2));
  console.log(JSON.stringify({attempted:result.attempted,succeeded:result.succeeded,failed:result.failed},null,2));
  if(result.failed) process.exitCode=1;
}
main().catch(async err=>{console.error(err);process.exit(1)});
