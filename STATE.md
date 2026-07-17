# Project state

Updated: 2026-07-17

## Status

The repository is not approved for production launch. The hardened candidate is on `main`, but production still runs an older artifact and its Supabase-backed APIs are failing. No on-chain transaction or database migration was executed during this work.

## Verified behavior

- Launch uses two explicit wallet approvals: pump.fun create and buy, then Streamflow lock.
- The Streamflow v13 instruction is a cliff-based token lock. Unlockable amount is zero before the selected timestamp and the full locked amount at that timestamp.
- The lock is non-cancelable, non-transferable, cannot be topped up, cannot be paused, cannot change rate, and does not auto-withdraw.
- Browser construction, pre-sign instruction decoding, finalized chain verification, and persisted receipt checks enforce the same lock invariants.
- Retry rebroadcasts the same signed lock transaction and checks the metadata account before permitting a rebuild.
- GitHub identity, signed wallet ownership, selected wallet, launch receipt, mint configuration, and lock receipt must agree before persistence.
- Public data is shown as unavailable or unverified when its source cannot be confirmed. No production mock fallback remains.
- Pump create/create_v2 and all four current buy variants use exact official account, PDA, ATA, program, payload, signer, and spend validation.
- Finalized launch verification rejects extra outer programs and binds the Pump TradeEvent, actual token purchase, metadata document, and persisted SOL spend.
- Wallet linking is immutable after the first verified link.

## Verification completed

- `npm test`: 16 passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed with Next.js 16.2.10
- Playwright: desktop and mobile routes, responsive menu, reduced motion, no horizontal overflow, no page console warnings
- Gitleaks: 14 commits scanned, no leaks
- Independent authentication, on-chain, deployment, and final patch reviews completed

## Known release gates

- Restore or provision the production Supabase project. The configured host no longer resolves and live stats/feed/cron routes fail.
- Configure and validate `PINATA_JWT`, `HELIUS_RPC_URL`, `ALLOWED_ORIGIN`, Supabase, OAuth, and cron production values. Do not reuse credentials from another project without an explicit rotation decision.
- Review existing production rows, then apply `supabase/migrations/002_backend_hardening.sql`.
- Resolve the two-transaction guarantee: Pump creation finalizes before a separate lock approval, and launch recovery is not durable across refresh/crash.
- Replace or supplement in-memory API throttling with a distributed deployment-layer rate limit.
- Resolve the current PumpPortal unsigned create HTTP 400 and repeat live construction against the strict validator.
- Deploy this commit to a preview and verify OAuth, wallet linking, metadata upload, RPC, finalized persistence, and runtime logs.
- Production dependency audit reports 5 high and 21 moderate transitive findings. Suggested automated fixes are unsafe downgrades or unavailable upstream fixes.
- After every gate above is green, run a disposable-wallet mainnet launch and lock. This needs explicit approval because it spends funds.
- Context7 documentation lookup is unavailable until its monthly quota resets; official primary documentation was used instead.
