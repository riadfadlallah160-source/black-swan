export const FLAUNCH_ORIGIN = 'https://web2-api.flaunch.gg';
const address = value => /^0x[\da-fA-F]{40}$/.test(value || '');
const hash = value => /^0x[\da-fA-F]{64}$/.test(value || '');

export async function readFlaunch(path, fetcher = fetch) {
  if (!/^\/(livez|api\/v1\/(config|launch-status\/[A-Za-z0-9_-]+))$/.test(path)) {
    throw new Error('Only documented read-only Flaunch endpoints are allowed');
  }
  const response = await fetcher(`${FLAUNCH_ORIGIN}${path}`, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Flaunch read failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || data.success === false) throw new Error('Flaunch returned an unsuccessful response');
  return data;
}

export async function inspectFlaunch(fetcher = fetch) {
  const [health, config] = await Promise.all([
    readFlaunch('/livez', fetcher),
    readFlaunch('/api/v1/config', fetcher),
  ]);
  const base = config.chains?.find(chain => chain.slug === 'base' && chain.chainId === 8453);
  return {
    healthy: health.status === 'ok' && health.checks?.rpc === true && health.checks?.redis === true,
    baseSupported: Boolean(base),
    serviceFundedLaunch: base?.capabilities?.serviceFundedLaunch === true,
    capabilities: base?.capabilities || {},
    sandbox: config.sandbox,
    // These are documentation limits, not measured sustained throughput.
    documentedLaunchRequestsPerMinute: 2,
    founderAllocationVerified: false,
    automaticPayoutsVerified: false,
    productionEligible: false,
  };
}

export function classifyFlaunchJob(data, beneficiary) {
  if (!address(beneficiary)) throw new Error('A valid beneficiary is required');
  if (!data || data.success !== true) return { state: 'unknown', confirmed: false, retrySafe: false };
  if (data.state === 'failed') {
    return { state: 'failed', confirmed: false, retrySafe: false, needsReconciliation: true };
  }
  if (data.state !== 'completed') return { state: 'pending', confirmed: false, retrySafe: false };
  if (!hash(data.transactionHash) || !address(data.collectionToken?.address)
      || data.collectionToken?.creator?.toLowerCase() !== beneficiary.toLowerCase()) {
    return { state: 'invalid-result', confirmed: false, retrySafe: false };
  }
  return {
    state: 'awaiting-chain-verification', confirmed: false, retrySafe: false,
    transactionHash: data.transactionHash, address: data.collectionToken.address,
  };
}

export async function verifyFlaunchJob(data, beneficiary, publicClient) {
  const job = classifyFlaunchJob(data, beneficiary);
  if (job.state !== 'awaiting-chain-verification') return job;
  if (await publicClient.getChainId() !== 8453) throw new Error('Wrong chain: expected Base');
  const receipt = await publicClient.getTransactionReceipt({ hash: job.transactionHash });
  if (receipt.transactionHash?.toLowerCase() !== job.transactionHash.toLowerCase() || receipt.status !== 'success') {
    return { ...job, state: 'reverted-or-invalid-receipt' };
  }
  const code = await publicClient.getCode({ address: job.address, blockNumber: receipt.blockNumber });
  if (!code || /^0x0*$/.test(code)) return { ...job, state: 'missing-contract' };
  // Receipt/code existence alone does not attest creator custody, allocations,
  // fee routing, or payout executability. Never turn this into a live ledger entry.
  return { ...job, state: 'chain-observed-economics-unverified', chainObserved: true };
}
