# Black Swan Launch Factory

Live narrative-discovery and launch-candidate scoring system for Base token-launch research.

## Running now

- Scheduled live scan every 5 minutes via GitHub Actions.
- Reads public Google Trends/Google News and CoinGecko trending data.
- Checks candidate-theme saturation against DEX Screener.
- Rejects violence, mass-casualty and tragedy narratives.
- Requires a score of 88/100 before a candidate is qualified.
- Persists latest candidates and ~24 hours of scan history under `data/`.

## Payout configuration

Creator/payout address: `0xf744573cdfFC211163c11c0a31730851Da78f708`

This address is treated as **Base-only**. Never route Solana or other-chain assets to it.

## Flaunch production facts verified from current official docs

- Web2 API supports no-wallet/no-gas token creation on Base.
- Launch endpoint: `POST /api/v1/base/launch-memecoin`.
- `creatorAddress` receives creator benefits.
- `creatorFeeSplit` defaults to 8000 (80%).
- `sniperProtection: true` enforces a 0.25% wallet cap during fair launch.
- Public limit is 2 launches/minute/IP; increased access can be requested from Flaunch.

## Financial execution boundary

The repository does **not** autonomously issue speculative tokens, execute buybacks, custody crypto, or sign financial transactions. It prepares and scores launch candidates and can produce approval-ready payloads. Final issuance/transaction approval must be performed through an authorized user-controlled execution path.

No private key or recovery phrase should ever be committed to this repository.

## Production activation

The scanner/packager runs continuously without a signer. Live deployment and
permissionless claims require a dedicated, gas-funded Base deployer stored as
the `DIRECT_DEPLOYER_PRIVATE_KEY` GitHub Actions secret (or a Clanker partner
key for launch-only deployment). Never use the beneficiary wallet's main key.

- One-click mode: run **Authorize & Launch Frozen 100**.
- Autonomous mode: set the repository variable `AUTO_OPERATIONS_ENABLED=true`.
- Optional claim floor: set `MIN_CLAIM_USDC` (default `1`) to avoid spending gas
  on tiny fee claims.

Autonomous maintenance claims creator USDC and matured 3%/7% founder
allocations directly to the configured beneficiary. It does not sell founder
tokens. Automated selling requires separately audited ExitVault custody and is
not represented as armed by this build.
