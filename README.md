# Black Swan Launch Factory

Live narrative-discovery and launch-candidate scoring system for Base token-launch research.

## Implemented scanner workflow (not proof of live financial operation)

- Scheduled live scan every 5 minutes via GitHub Actions.
- Reads public Google Trends/Google News and CoinGecko trending data.
- Checks candidate-theme saturation against DEX Screener.
- Rejects violence, mass-casualty and tragedy narratives.
- Requires a score of 65/100 before a candidate is qualified.
- Persists latest candidates and ~24 hours of scan history under `data/`.

## Payout configuration

Creator/payout address: `0xf744573cdfFC211163c11c0a31730851Da78f708`

This address is treated as **Base-only**. Never route Solana or other-chain assets to it.

## Flaunch production facts verified from current official docs

- Web2 API supports no-wallet/no-gas token creation on Base.
- Launch endpoint: `POST /api/v1/base/launch-memecoin`.
- `creatorAddress` receives creator benefits.
- `creatorFeeSplit` defaults to 8000 (80%).
- Sniper protection and fair launch are currently paused; the payload omits activation.
- Public limit is 2 launches/minute/IP; increased access can be requested from Flaunch.

## Financial execution boundary

The repository does **not** autonomously issue speculative tokens, execute buybacks, custody crypto, or sign financial transactions. It prepares and scores launch candidates and can produce approval-ready payloads. Final issuance/transaction approval must be performed through an authorized user-controlled execution path.

No private key or recovery phrase should ever be committed to this repository.

## Zero-cost execution requirements

The production requirement is 100 launches/hour (2,400/day), no user-paid
launch gas or developer purchase, and both creator fees and the existing 10%
founder allocation. No verified provider currently satisfies the entire model
in this repository. Launching is blocked; setting a LIVE flag does not bypass
this requirement. A zero-value wallet transaction still consumes gas.

Run `npm run verify:rails` for fresh read-only Flaunch health and capability
checks. The result is saved to `data/rail-readiness.json`; the scan workflow
also refreshes it. Run `npm test` for deterministic integration/policy tests.
The 36-second attempt spacing is tested scheduling logic, not an enabled worker
or evidence of achieved throughput.

The Flaunch read-only client distinguishes queued, completed, reverted and
unverified job states. Even receipt/code observation is not proof of correct
economic ownership. It never adds unverified tokens to the live ledger.
The payload is a fee-stream candidate only: it does not include a documented
free founder allocation. It is not a substitute for the required two streams.

Clanker partner sponsorship and account capacity remain unverified. Direct
wallet launch is prohibited by the cost policy. Claims code exists but is not
live-verified; automatic founder selling is not implemented or armed. Do not
enable financial workflows as a substitute for resolving those prerequisites.

Primary references: [Flaunch API](https://docs.flaunch.gg/references/api),
[Clanker partner API](https://clanker.gitbook.io/documentation/api-reference/authenticated),
[Bankr limits](https://docs.bankr.bot/token-launching/overview/).
