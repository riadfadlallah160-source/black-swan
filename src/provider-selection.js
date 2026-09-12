export const PROVIDERS = Object.freeze([
  {
    id: 'flaunch',
    recommendation: 'closest',
    chain: 'Base',
    serviceFunded: true,
    documentedRatePerHour: 120,
    founderAllocation: 'unverified',
    automaticPayouts: 'unverified',
    reason: 'Only accessible option that documents both service-funded Base launches and a rate above the 100/hour target.',
  },
  {
    id: 'bankr',
    recommendation: 'not-sufficient-throughput',
    chain: 'Base',
    serviceFunded: true,
    documentedRatePerHour: 0.125,
    founderAllocation: '15% vesting',
    automaticPayouts: 'claim flow documented',
    reason: 'Economics are closer, but three counted launches per wallet per rolling 24 hours cannot meet the target.',
  },
  {
    id: 'clanker',
    recommendation: 'economics-candidate',
    chain: 'Base',
    serviceFunded: 'unverified',
    documentedRatePerHour: 'unverified',
    founderAllocation: 'custom 10% prepared in our package model',
    automaticPayouts: 'unverified',
    reason: 'The package model fits the requested economics, but partner sponsorship and capacity are not verified.',
  },
]);

export const RECOMMENDED_RAIL = 'flaunch';

export function productionGate(provider, { founderAllocationVerified = false, payoutsVerified = false } = {}) {
  if (provider !== RECOMMENDED_RAIL) return { allowed: false, reason: `Provider ${provider} is not the selected closest rail.` };
  if (!founderAllocationVerified) return { allowed: false, reason: 'Flaunch founder allocation is not verified.' };
  if (!payoutsVerified) return { allowed: false, reason: 'Flaunch automatic payouts are not verified.' };
  return { allowed: true, reason: 'All selected-rail requirements verified.' };
}
