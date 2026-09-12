// No environment flag may silently replace the user's zero-launch-cost rule.
export const LAUNCH_REQUIREMENTS = Object.freeze({
  chainId: 8453,
  targetPerHour: 100,
  targetPerDay: 2400,
  maxUserLaunchCostWei: '0',
  founderAllocationBps: 1000,
  automaticPayoutsRequired: true,
});

export function assertZeroCostRail(rail) {
  const reasons = {
    'direct-clanker-v4': 'Direct wallet deployment requires user-paid network gas; zero transaction value does not mean zero gas.',
    'clanker-partner-api': 'Partner gas sponsorship and 2,400/day allowance have not been verified for this account.',
    flaunch: 'Gasless launch is documented, but the required free 10% founder allocation and automatic payouts are not verified.',
  };
  throw new Error(`Launch blocked by zero-cost/two-stream policy: ${reasons[rail] || 'Unknown launch provider.'}`);
}

export function nextLaunchAt(previousAt, now) {
  if (!Number.isFinite(now) || now < 0 || (previousAt !== null && (!Number.isFinite(previousAt) || previousAt < 0))) {
    throw new Error('Launch timestamps must be finite non-negative numbers');
  }
  // One attempt every 36 seconds. Retries also consume a slot; never catch up
  // with bursts or evade provider restrictions with extra accounts/IPs.
  return previousAt === null ? now : Math.max(now, previousAt + 36_000);
}
