import fs from 'node:fs/promises';
import path from 'node:path';

const BATCH = path.resolve('data/exit-batch.json');

async function main() {
  const batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  if (!batch?.id || !Array.isArray(batch.positions) || batch.positions.length === 0) throw new Error('No founder exit batch is ready.');
  if (batch.status === 'authorized') {
    console.log(JSON.stringify({ id: batch.id, status: batch.status, count: batch.count }, null, 2));
    return;
  }
  if (batch.status !== 'awaiting-authorization') throw new Error(`Exit batch ${batch.id} cannot be authorized from status ${batch.status}`);
  batch.status = 'authorized';
  batch.authorizedAt = new Date().toISOString();
  batch.authorization = {
    scope: 'entire-founder-exit-batch',
    count: batch.positions.length,
    note: 'This records one human authorization for the eligible staged tranches. It does not itself sign or broadcast swaps.'
  };
  await fs.writeFile(BATCH, JSON.stringify(batch, null, 2));
  console.log(JSON.stringify({ id: batch.id, status: batch.status, count: batch.count }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
