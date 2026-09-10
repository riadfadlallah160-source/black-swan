import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const LATEST = path.resolve('data/latest.json');
const OUT = path.resolve('data/launch-batch.json');
const HISTORY = path.resolve('data/package-history.json');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXIT_VAULT = process.env.EXIT_VAULT_ADDRESS || null;
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const titleCase = s => String(s||'').replace(/\b\w/g, c => c.toUpperCase()).slice(0,50);

function svgData(name, symbol) {
  const seed = [...name].reduce((a,c)=>((a*33)+c.charCodeAt(0))>>>0, 5381);
  const h1 = seed % 360;
  const h2 = (h1 + 71 + (seed % 93)) % 360;
  const esc = x => String(x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h1} 78% 48%)"/><stop offset="1" stop-color="hsl(${h2} 75% 35%)"/></linearGradient></defs><rect width="1024" height="1024" rx="180" fill="url(#g)"/><circle cx="512" cy="410" r="270" fill="none" stroke="white" stroke-opacity=".26" stroke-width="48"/><path d="M270 620 Q512 390 754 620 Q512 850 270 620Z" fill="white" fill-opacity=".14"/><text x="512" y="570" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="800" fill="white">${esc(symbol.slice(0,8))}</text><text x="512" y="710" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="600" fill="white" fill-opacity=".86">${esc(name.slice(0,28))}</text></svg>`;
}

function makePackage(c) {
  const clean = titleCase(c.title);
  const symbol = String(c.suggestedSymbol || 'PULSE').replace(/[^A-Z0-9]/g,'').slice(0,8) || 'PULSE';
  const assetKey = crypto.createHash('sha256').update(`${clean}|${symbol}`).digest('hex').slice(0,16);
  const imagePath = `assets/generated/${assetKey}.svg`;
  const imageUrl = `https://raw.githubusercontent.com/riadfadlallah160-source/black-swan/main/${imagePath}`;
  const requestKey = crypto.createHash('sha256').update(`${clean}|${symbol}|${new Date().toISOString().slice(0,13)}`).digest('hex').slice(0,32);
  const founderRecipient = EXIT_VAULT || CONFIG.creatorAddress;
  const description = `${CONFIG.unofficialDisclosure} Theme: ${clean}. Creator allocation and creator rewards are disclosed on-chain.`;

  return {
    narrative: c.title,
    score: c.score,
    category: c.category,
    saturation: c.dex,
    rationale: c.rationale,
    token: { name: clean, symbol, description, imagePath, imageUrl, svg: svgData(clean, symbol) },
    economics: {
      stream1: 'Creator LP rewards paid in Base USDC to beneficiary',
      stream2: '10% founder allocation at mint; disclosed and locked before release',
      devBuyEth: 0,
      beneficiary: CONFIG.creatorAddress,
      founderRecipient,
      exitVaultReady: Boolean(EXIT_VAULT)
    },
    clanker: {
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
        initialMarketCap: 10000
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
      devBuy: null,
      sniperFees: CONFIG.clanker.sniperFees
    },
    readiness: EXIT_VAULT ? 'launch-api-ready' : 'waiting-for-exit-vault-address'
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
    chosen.push(makePackage(c)); seen.add(key);
    if (chosen.length >= CONFIG.targetPackagesPerScan) break;
  }
  for (const p of chosen) {
    await fs.mkdir(path.dirname(p.token.imagePath), {recursive:true});
    await fs.writeFile(p.token.imagePath, p.token.svg);
    delete p.token.svg;
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
    status: EXIT_VAULT ? 'ready for authenticated Clanker deployment API' : 'economics packaged; ExitVault must be deployed once before automated founder exits'
  };
  for (const p of chosen) history.items.push({key:norm(p.narrative),at:generatedAt,score:p.score});
  await fs.writeFile(OUT,JSON.stringify(batch,null,2));
  await fs.writeFile(HISTORY,JSON.stringify(history,null,2));
  console.log(JSON.stringify({generatedAt,count:chosen.length,targetPerHour:batch.targetPerHour,rail:CONFIG.issuanceRail,exitVaultReady:Boolean(EXIT_VAULT),packages:chosen.map(x=>({name:x.token.name,symbol:x.token.symbol,score:x.score}))},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
