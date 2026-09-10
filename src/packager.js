import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const LATEST = path.resolve('data/latest.json');
const OUT = path.resolve('data/launch-batch.json');
const HISTORY = path.resolve('data/package-history.json');

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const titleCase = s => String(s||'').replace(/\b\w/g, c => c.toUpperCase()).slice(0,50);

function makePackage(c) {
  const clean = titleCase(c.title);
  const symbol = String(c.suggestedSymbol || 'PULSE').replace(/[^A-Z0-9]/g,'').slice(0,8) || 'PULSE';
  return {
    narrative: c.title,
    score: c.score,
    category: c.category,
    saturation: c.dex,
    rationale: c.rationale,
    token: {
      name: clean,
      symbol,
      description: `Unofficial culture token inspired by current public interest in ${clean}. No affiliation or endorsement is claimed. Creator fees may accrue to the disclosed creator address.`,
      imagePrompt: `Bold original square meme-token artwork inspired by the theme: ${clean}. No logos, no trademarks, no realistic impersonation, no violence, no text except ${symbol}.`,
    },
    flaunch: {
      creatorAddress: CONFIG.creatorAddress,
      marketCap: '10000000000',
      creatorFeeSplit: String(CONFIG.creatorFeeSplitBps),
      fairLaunchDuration: '1800',
      fairLaunchSupply: 60,
      sniperProtection: CONFIG.sniperProtection
    }
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
    if (!key || seen.has(key)) continue;
    if (chosen.some(x => norm(x.narrative) === key)) continue;
    chosen.push(makePackage(c));
    seen.add(key);
    if (chosen.length >= CONFIG.targetPackagesPerScan) break;
  }

  const generatedAt = new Date().toISOString();
  const batch = {
    generatedAt,
    targetPerScan: CONFIG.targetPackagesPerScan,
    targetPerHour: CONFIG.targetPackagesPerScan * 12,
    creatorAddress: CONFIG.creatorAddress,
    count: chosen.length,
    packages: chosen,
    status: 'approval-ready; not submitted by this workflow'
  };
  for (const p of chosen) history.items.push({key:norm(p.narrative), at:generatedAt, score:p.score});
  await fs.writeFile(OUT, JSON.stringify(batch,null,2));
  await fs.writeFile(HISTORY, JSON.stringify(history,null,2));
  console.log(JSON.stringify({generatedAt,count:chosen.length,targetPerHour:batch.targetPerHour,packages:chosen.map(x=>({name:x.token.name,symbol:x.token.symbol,score:x.score}))},null,2));
}

main().catch(e=>{console.error(e);process.exit(1)});
