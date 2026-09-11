import fs from 'node:fs/promises';
import path from 'node:path';

const BATCH = path.resolve('data/approval-batch.json');

async function main() {
  const batch = JSON.parse(await fs.readFile(BATCH, 'utf8'));
  if (!batch?.id || !Array.isArray(batch.packages) || batch.packages.length === 0) {
    throw new Error('No approval batch is ready.');
  }
  if (batch.status === 'authorized') {
    console.log(JSON.stringify({ id: batch.id, status: batch.status, count: batch.count }, null, 2));
    return;
  }
  if (batch.status !== 'awaiting-authorization') {
    throw new Error(`Batch ${batch.id} cannot be authorized from status ${batch.status}`);
  }
  batch.status = 'authorized';
  batch.authorizedAt = new Date().toISOString();
  batch.authorization = {
    scope: 'entire-frozen-batch',
    count: batch.packages.length,
    note: 'This records one human authorization for the frozen package set. It does not itself sign or broadcast financial transactions.'
  };
  await fs.writeFile(BATCH, JSON.stringify(batch, null, 2));
  console.log(JSON.stringify({ id: batch.id, status: batch.status, count: batch.count }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
