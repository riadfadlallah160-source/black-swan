import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { CONFIG } from './config.js';

const LATEST = path.resolve('data/latest.json');
const OUT = path.resolve('data/launch-batch.json');
const HISTORY = path.resolve('data/package-history.json');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXIT_VAULT = process.env.EXIT_VAULT_ADDRESS || '';
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const TOTAL_SUPPLY_TOKENS = 100_000_000_000n; // Clanker V4 fixed supply
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const titleCase = s => String(s||'').replace(/\b\w/g, c => c.toUpperCase()).slice(0,50);

function svgArtwork(name, symbol) {
  const seed = [...name].reduce((a,c)=>((a*33)+c.charCodeAt(0))>>>0, 5381);
  const h1 = seed % 360;
  const h2 = (h1 + 71 + (seed % 93)) % 360;
  const esc = x => String(x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h1} 78% 48%)"/><stop offset="1" stop-color="hsl(${h2} 75% 35%)"/></linearGradient></defs><rect width="1024" height="1024" rx="180" fill="url(#g)"/><circle cx="512" cy="410" r="270" fill="none" stroke="white" stroke-opacity=".26" stroke-width="48"/><path d="M270 620 Q512 390 754 620 Q512 850 270 620Z" fill="white" fill-opacity=".14"/><text x="512" y="570" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="800" fill="white">${esc(symbol.slice(0,8))}</text><text x="512" y="710" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="600" fill="white" fill-opacity=".86">${esc(name.slice(0,28))}</text></svg>`;
}

function buildEarlyAirdrop(recipient) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) return null;
  const amountTokens = Number((TOTAL_SUPPLY_TOKENS * BigInt(CONFIG.clanker.earlyAirdropPercentage)) / 100n);
  const amountWei = (BigInt(amountTokens) * 10n ** 18n).toString();
  const tree = StandardMerkleTree.of([[recipient, amountWei]], ['address','uint256']);
  tree.validate();
  return {
    config: {
      admin: CONFIG.creatorAddress,
      merkleRoot: tree.root,
      lockupDuration: CONFIG.clanker.earlyAirdropLockupSeconds,
      vestingDuration: CONFIG.clanker.earlyAirdropVestingSeconds,
      amount: amountTokens
    },
    claim: {
      recipient,
      allocatedAmount: amountWei,
      proof: tree.getProof(0),
      tree: tree.dump()
    }
  };
}

async function makePackage(c) {
  const clean = titleCase(c.title);
  const symbol = String(c.suggestedSymbol || 'PULSE').replace(/[^A-Z0-9]/g,'').slice(0,8) || 'PULSE';
  const assetKey = crypto.createHash('sha256').update(`${clean}|${symbol}`).digest('hex').slice(0,16);
  const imagePath = `assets/generated/${assetKey}.png`;
  const imageUrl = `https://raw.githubusercontent.com/riadfadlallah160-source/black-swan/main/${imagePath}`;
  const requestKey = crypto.createHash('sha256').update(`${clean}|${symbol}|${new Date().toISOString().slice(0,13)}`).digest('hex').slice(0,32);
  const early = buildEarlyAirdrop(EXIT_VAULT);
  const founderRecipient = early ? EXIT_VAULT : CONFIG.creatorAddress;
  const description = `${CONFIG.unofficialDisclosure} Theme: ${clean}. Founder allocation and creator rewards are disclosed on-chain.`;

  await fs.mkdir(path.dirname(imagePath), {recursive:true});
  await sharp(Buffer.from(svgArtwork(clean, symbol))).png({compressionLevel:9}).toFile(imagePath);

  const clanker = {
    endpoint: 'https://www.clanker.world/api/tokens/deploy',
    chainId: CONFIG.chainId,
    dryRun: false,
    token: {
      name: clean,
      symbol,
      image: imageUrl,
      tokenAdmin: CONFIG.creatorAddress,
      description,
      requestKey
    },
    rewards: [{
      recipient: CONFIG.creatorAddress,
      admin: CONFIG.creatorAddress,
      allocation: 100,
      rewardsToken: 'Paired'
    }],
    pool: {
      pairedToken: BASE_USDC,
      initialMarketCap: CONFIG.clanker.initialMarketCapUsdc
    },
    fees: {
      type: 'static',
      clankerFee: CONFIG.clanker.staticFeeBps,
      pairedFee: CONFIG.clanker.staticFeeBps
    },
    vault: {
      percentage: CONFIG.clanker.founderVaultPercentage,
      lockupDuration: CONFIG.clanker.founderVaultLockupSeconds,
      vestingDuration: CONFIG.clanker.founderVaultVestingSeconds,
      recipient: founderRecipient
    },
    sniperFees: CONFIG.clanker.sniperFees
  };
  if (early) clanker.airdrop = early.config;

  return {
    narrative: c.title,
    score: c.score,
    category: c.category,
    saturation: c.dex,
    rationale: c.rationale,
    token: { name: clean, symbol, description, imagePath, imageUrl },
    economics: {
      stream1: 'Creator LP rewards in Base USDC to beneficiary',
      stream2: `${CONFIG.clanker.earlyAirdropPercentage}% founder allocation after 1 day + ${CONFIG.clanker.founderVaultPercentage}% after 7 days`,
      totalFounderAllocationPercentage: CONFIG.clanker.earlyAirdropPercentage + CONFIG.clanker.founderVaultPercentage,
      devBuyEth: 0,
      beneficiary: CONFIG.creatorAddress,
      founderRecipient,
      exitVaultReady: Boolean(early)
    },
    earlyAirdropClaim: early?.claim || null,
    clanker,
    readiness: early ? 'launch-api-ready' : 'waiting-for-exit-vault-address'
  };
}

async function main() {
  const latest = JSON.parse(await fs.readFile(LATEST,'utf8'));
  let history = {items:[]};
  try { history = JSON.parse(await fs.readFile(HISTORY,'utf8')); } catch {}
  history.items = (history.items||[]).filter(x => now - new Date(x.at).getTime() < DAY);
  const seen = new Set(history.items.map(x => x.key));
  const source = [...(latest.qualified||[]), ...(latest.watchlist||[])];
  const chosen = [];
  for (const c of source) {
    if (Number(c.score) < CONFIG.scoreThreshold) continue;
    const key = norm(c.title);
    if (!key || seen.has(key) || chosen.some(x => norm(x.narrative) === key)) continue;
    chosen.push(await makePackage(c));
    seen.add(key);
    if (chosen.length >= CONFIG.targetPackagesPerScan) break;
  }
  const generatedAt = new Date().toISOString();
  const batch = {
    generatedAt,
    targetPerScan: CONFIG.targetPackagesPerScan,
    targetPerHour: CONFIG.targetPackagesPerHour,
    issuanceRail: CONFIG.issuanceRail,
    beneficiary: CONFIG.creatorAddress,
    baseUsdc: BASE_USDC,
    count: chosen.length,
    packages: chosen,
    status: EXIT_VAULT ? 'ready for authenticated Clanker deployment API' : 'economics packaged; deploy ExitVault once before live issuance'
  };
  for (const p of chosen) history.items.push({key:norm(p.narrative),at:generatedAt,score:p.score});
  await fs.writeFile(OUT,JSON.stringify(batch,null,2));
  await fs.writeFile(HISTORY,JSON.stringify(history,null,2));
  console.log(JSON.stringify({generatedAt,count:chosen.length,targetPerHour:batch.targetPerHour,rail:CONFIG.issuanceRail,exitVaultReady:Boolean(EXIT_VAULT),packages:chosen.map(x=>({name:x.token.name,symbol:x.token.symbol,score:x.score}))},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
