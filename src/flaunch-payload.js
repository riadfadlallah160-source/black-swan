import { CONFIG } from './config.js';

export function buildFlaunchPayload(candidate, imageIpfs) {
  if (!candidate?.qualified || Number(candidate.score) < CONFIG.scoreThreshold) {
    throw new Error('Candidate has not passed the production score threshold');
  }
  if (!imageIpfs || typeof imageIpfs !== 'string') {
    throw new Error('A validated Flaunch imageIpfs value is required');
  }

  return {
    name: String(candidate.title).slice(0, 64),
    symbol: String(candidate.suggestedSymbol || 'PULSE').replace(/[^A-Za-z0-9]/g, '').slice(0, 8),
    description: `A fair-launch token inspired by the emerging ${candidate.category || 'internet'} narrative: ${candidate.title}. No promise of returns or affiliation is implied.`,
    imageIpfs,
    creatorAddress: CONFIG.creatorAddress,
    sniperProtection: true,
    marketCap: 10000000000,
    creatorFeeSplit: CONFIG.creatorFeeSplitBps
  };
}

export const FLAUNCH_ENDPOINT = 'https://web2-api.flaunch.gg/api/v1/base/launch-memecoin';

// Financial issuance is intentionally not performed in this module. The payload
// is designed for an authorized, user-controlled final execution step.
