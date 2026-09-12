import { CONFIG } from './config.js';

export function buildFlaunchPayload(candidate, imageIpfs) {
  if (candidate?.qualified !== true || !Number.isFinite(Number(candidate.score)) || Number(candidate.score) < CONFIG.scoreThreshold) {
    throw new Error('Candidate has not passed the production score threshold');
  }
  if (typeof imageIpfs !== 'string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,})$/.test(imageIpfs)) {
    throw new Error('A validated Flaunch imageIpfs value is required');
  }

  const name = String(candidate.title || '').trim().slice(0, 64);
  const symbol = String(candidate.suggestedSymbol || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  if (!name || !symbol) throw new Error('A non-empty token name and symbol are required');
  return {
    name,
    symbol,
    description: `A token inspired by the emerging ${candidate.category || 'internet'} narrative: ${name}. No promise of returns or affiliation is implied.`,
    imageIpfs,
    creatorAddress: CONFIG.creatorAddress,
    sniperProtection: false,
    marketCap: 10000000000,
    creatorFeeSplit: 8000
  };
}

export const FLAUNCH_ENDPOINT = 'https://web2-api.flaunch.gg/api/v1/base/launch-memecoin';

// Financial issuance is intentionally not performed in this module. The payload
// is designed for an authorized, user-controlled final execution step.
