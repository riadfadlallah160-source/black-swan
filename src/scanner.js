import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';

const UA = 'BlackSwanNarrativeScanner/1.3';
const OUT = path.resolve('data/latest.json');
const HISTORY = path.resolve('data/history.json');

function decodeXml(s='') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function rssItems(xml, source) {
  const items=[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m=>m[0]);
  return items.slice(0,80).map((raw,rank)=>{
    const title=decodeXml((raw.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||'');
    const trafficRaw=decodeXml((raw.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)||[])[1]||'0');
    return {title,source,rank:rank+1,traffic:Number(trafficRaw.replace(/[^0-9]/g,''))||0};
  }).filter(x=>x.title.length>=3);
}
async function getText(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/rss+xml,text/xml,text/plain,*/*'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text();}
async function getJson(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();}
function keyOf(s){return s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an|and|or|of|to|in|on|for|with|vs|at|by)\b/g,' ').replace(/\s+/g,' ').trim().slice(0,100);}
function words(s){return keyOf(s).split(' ').filter(w=>w.length>2);}
function containsBlocked(s){const t=s.toLowerCase();return CONFIG.blockedNarrativeTerms.some(term=>t.includes(term));}
function tokenSet(s){return new Set(s.toLowerCase().match(/[a-z0-9]+/g)||[]);}
function hasAny(set,list){return list.some(x=>set.has(x));}
function category(s){
  const t=tokenSet(s);
  if(hasAny(t,['game','gaming','xbox','playstation','steam','nintendo']))return 'gaming';
  if(hasAny(t,['ai','robot','tech','technology','iphone','android','software','space']))return 'technology';
  if(hasAny(t,['football','soccer','nba','nfl','f1','tennis','goal','match']))return 'sports';
  if(hasAny(t,['crypto','bitcoin','ethereum','solana','token','defi']))return 'crypto';
  if(hasAny(t,['meme','viral','internet','trend','streamer','youtube','tiktok']))return 'internet-culture';
  return 'general-culture';
}
function tickerFrom(title){const banned=new Set(['THE','AND','FOR','WITH','FROM','THIS','THAT','NEWS','LIVE','TODAY']);const ws=words(title).map(x=>x.toUpperCase()).filter(x=>!banned.has(x));return (ws[0]||'PULSE').replace(/[^A-Z0-9]/g,'').slice(0,8)||'PULSE';}
async function dexSaturation(title){const q=encodeURIComponent(words(title).slice(0,4).join(' '));if(!q)return{pairs:0,active:0,liquid:0};try{const j=await getJson(`https://api.dexscreener.com/latest/dex/search?q=${q}`);const pairs=Array.isArray(j?.pairs)?j.pairs:[];return{pairs:pairs.length,active:pairs.filter(p=>Number(p?.volume?.h24||0)>10000).length,liquid:pairs.filter(p=>Number(p?.liquidity?.usd||0)>10000).length};}catch{return{pairs:null,active:null,liquid:null};}}
function finishScore(c){
  if(containsBlocked(c.title)){c.score=0;c.qualified=false;c.blocked=true;return c;}
  if(c.dex.active>=8)c.score-=24;else if(c.dex.active>=3)c.score-=13;else if(c.dex.pairs>=12)c.score-=8;
  if(c.dex.pairs===0)c.score+=8; else if(c.dex.active===0&&c.dex.liquid<=1)c.score+=3;
  c.score=Math.max(0,Math.min(100,Math.round(c.score)));c.qualified=c.score>=CONFIG.scoreThreshold;c.suggestedSymbol=tickerFrom(c.title);
  c.rationale=[c.sources.includes('google-trends')?'active search trend':null,c.sources.includes('google-news')?'news confirmation':null,c.traffic?`approx trend traffic ${c.traffic.toLocaleString()}`:null,c.dex.pairs===0?'no matching DEX pairs detected':null,c.dex.active>0?`${c.dex.active} active matching DEX pairs (saturation risk)`:null,c.cryptoTrendingOverlap?'already overlaps crypto trending list':null].filter(Boolean);return c;
}
async function main(){
  const raw=[];const errors=[];const rssUrls=[...CONFIG.feeds.googleTrends,...CONFIG.feeds.googleNews];
  const rssResults=await Promise.allSettled(rssUrls.map(async url=>{const xml=await getText(url);return rssItems(xml,url.includes('trends.google')?'google-trends':'google-news');}));
  rssResults.forEach(r=>r.status==='fulfilled'?raw.push(...r.value):errors.push(String(r.reason?.message||r.reason)));
  const cryptoNames=new Set();try{const j=await getJson(CONFIG.feeds.coinGeckoTrending);for(const c of(j?.coins||[])){const item=c?.item||{};for(const n of[item.name,item.symbol])if(n)cryptoNames.add(String(n).toLowerCase());}}catch(e){errors.push(`coingecko:${e.message}`);}
  const grouped=new Map();for(const item of raw){if(containsBlocked(item.title))continue;const k=keyOf(item.title);if(!k)continue;const existing=grouped.get(k)||{title:item.title,mentions:[],bestRank:999,traffic:0};existing.mentions.push(item.source);existing.bestRank=Math.min(existing.bestRank,item.rank);existing.traffic=Math.max(existing.traffic,item.traffic||0);grouped.set(k,existing);}
  let candidates=[...grouped.values()].map(x=>{const uniq=[...new Set(x.mentions)];let score=40;if(uniq.includes('google-trends'))score+=22;if(uniq.includes('google-news'))score+=10;if(uniq.length>1)score+=10;score+=Math.max(0,14-Math.floor(x.bestRank/5));if(x.traffic>=100000)score+=10;else if(x.traffic>=20000)score+=7;else if(x.traffic>=2000)score+=4;const overlap=[...cryptoNames].some(n=>n.length>3&&x.title.toLowerCase().includes(n));if(overlap)score-=14;return{...x,sources:uniq,score,category:category(x.title),cryptoTrendingOverlap:overlap};}).sort((a,b)=>b.score-a.score).slice(0,CONFIG.maxCandidatesPerScan);
  candidates=await Promise.all(candidates.map(async c=>finishScore({...c,dex:await dexSaturation(c.title)})));candidates.sort((a,b)=>b.score-a.score);
  let previous={runs:[]};try{previous=JSON.parse(await fs.readFile(HISTORY,'utf8'));}catch{}
  const now=new Date().toISOString();const qualified=candidates.filter(x=>x.qualified&&!x.blocked).slice(0,CONFIG.maxCandidatesPerScan);const report={generatedAt:now,threshold:CONFIG.scoreThreshold,targetPackagesPerScan:CONFIG.targetPackagesPerScan,creatorAddress:CONFIG.creatorAddress,qualifiedCount:qualified.length,qualified,watchlist:candidates.filter(x=>!x.blocked).slice(0,CONFIG.maxCandidatesPerScan),feedErrors:errors};
  previous.runs=(previous.runs||[]).slice(-287);previous.runs.push({generatedAt:now,qualified:qualified.map(x=>({title:x.title,score:x.score,symbol:x.suggestedSymbol}))});await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2));await fs.writeFile(HISTORY,JSON.stringify(previous,null,2));console.log(JSON.stringify({generatedAt:now,qualifiedCount:qualified.length,top:qualified.slice(0,10).map(x=>({title:x.title,score:x.score}))},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
