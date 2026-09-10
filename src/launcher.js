import fs from 'node:fs/promises';
import path from 'node:path';

const BATCH = path.resolve('data/launch-batch.json');
const OUT = path.resolve('data/launch-results.json');
const API_KEY = process.env.CLANKER_API_KEY || '';
const EXIT_VAULT = process.env.EXIT_VAULT_ADDRESS || '';
const LIVE = process.env.LIVE_LAUNCH_ENABLED === 'true';
const ENDPOINT = 'https://www.clanker.world/api/tokens/deploy';

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function deploy(p) {
  const body = structuredClone(p.clanker);
  body.token.image = p.token.imageUrl;
  body.token.tokenAdmin = p.economics.beneficiary;
  body.vault.recipient = EXIT_VAULT;
  body.dryRun = false;
  delete body.endpoint;
  delete body.devBuy; // absence = zero dev-buy in Clanker V4

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {'content-type':'application/json','x-api-key':API_KEY},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {raw:text}; }
  if (!response.ok || data?.success === false) {
    throw new Error(`Clanker ${response.status}: ${JSON.stringify(data).slice(0,700)}`);
  }
  return data;
}

async function main() {
  const batch = JSON.parse(await fs.readFile(BATCH,'utf8'));
  const base = {at:new Date().toISOString(),live:LIVE,batchGeneratedAt:batch.generatedAt,attempted:0,succeeded:0,failed:0,results:[]};

  if (!LIVE) {
    base.blocked='LIVE_LAUNCH_ENABLED is not true';
    await fs.writeFile(OUT,JSON.stringify(base,null,2));
    console.log('Launcher not armed: LIVE_LAUNCH_ENABLED != true');
    return;
  }
  if (!API_KEY) {
    base.blocked='CLANKER_API_KEY is missing';
    await fs.writeFile(OUT,JSON.stringify(base,null,2));
    console.log('Launcher not armed: CLANKER_API_KEY missing');
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(EXIT_VAULT)) {
    base.blocked='EXIT_VAULT_ADDRESS is missing or invalid';
    await fs.writeFile(OUT,JSON.stringify(base,null,2));
    console.log('Launcher not armed: EXIT_VAULT_ADDRESS missing/invalid');
    return;
  }

  // Work in groups of three to avoid a request burst while sustaining >100/hour capacity.
  const packages=(batch.packages||[]).slice(0,9);
  for (let i=0;i<packages.length;i+=3) {
    const group=packages.slice(i,i+3);
    const settled=await Promise.allSettled(group.map(async p=>({p,data:await deploy(p)})));
    for (const s of settled) {
      base.attempted++;
      if (s.status==='fulfilled') {
        base.succeeded++;
        const {p,data}=s.value;
        base.results.push({name:p.token.name,symbol:p.token.symbol,success:true,expectedAddress:data.expectedAddress||data.address||data.contract_address||null,response:data});
      } else {
        base.failed++;
        base.results.push({success:false,error:String(s.reason?.message||s.reason).slice(0,900)});
      }
    }
    if (i+3<packages.length) await sleep(3000);
  }
  await fs.writeFile(OUT,JSON.stringify(base,null,2));
  console.log(JSON.stringify({attempted:base.attempted,succeeded:base.succeeded,failed:base.failed},null,2));
  if (base.failed) process.exitCode=1;
}
main().catch(async e=>{console.error(e);process.exit(1)});
