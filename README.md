# Black Swan Launch Factory

Dry-run-first token launch orchestration service.

## Safety defaults

- `LIVE_LAUNCH_ENABLED=false` by default.
- No private keys or seed phrases are stored.
- The creator/payout address is a public Base address supplied by the owner.
- `/candidate` only queues concepts scoring 85 or higher.
- `/launch` refuses live issuance unless the live flag is explicitly enabled and a verified launch adapter is installed.

## Current payout address

`0xf744573cdfFC211163c11c0a31730851Da78f708` (Base assets only)

## Endpoints

- `GET /health`
- `GET /status`
- `POST /candidate`
- `POST /launch` (disabled in this build)

## Next production gate

Before live issuance, verify the current Flaunch API request schema, creator-revenue routing, anti-sniper parameters, manager configuration, and one controlled end-to-end launch. Do not route non-Base assets to the configured payout address.
