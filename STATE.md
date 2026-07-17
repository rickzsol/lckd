# Project state

Updated: 2026-07-17

## Status

Production remains fail-closed and is not approved for public launches. The code-side release candidate is isolated on `codex/production-hardening`; production Supabase access and the locking-guarantee decision remain external gates. No on-chain transaction or database migration was executed.

## Completed in this release lane

- Replaced the broken PumpPortal create endpoint with official Pump SDK 1.36.0 construction.
- Live unsigned mainnet construction simulated successfully at 198,375 CU and 1,162 serialized bytes.
- Added shared atomic rate limiting with production fail-closed behavior.
- Added authenticated durable launch recovery with immutable intent preparation, CAS checkpoints, finality reconciliation, safe expiry handling, and one active intent per owner.
- Made verified token persistence plus recovery completion one database transaction.
- Bound approved IPFS metadata and the reviewed lock percentage to finalized receipts.
- Configured and validated Production `PINATA_JWT`, `HELIUS_RPC_URL`, and `ALLOWED_ORIGIN`; Preview has a dedicated Helius value.
- Built a protected Vercel Preview successfully.

## Verification

- `npm test`: 21 passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed with Next.js 16.2.10
- Vercel Preview build: passed
- Independent reviews: Pump construction, atomic feasibility, distributed limiter, recovery state machine
- No transaction signed or sent

## Open release gates

- Restore the intended Supabase project or provide a new production and staging project.
- Inspect existing data, dry-run, then apply migrations 002, 003, and 004 in order.
- Run database integration, OAuth, wallet-link, upload, recovery, and finalized persistence tests on staging.
- Choose the production guarantee:
  - Listing-gated: LCKD records and publishes only finalized locked launches, but a Pump token can exist unlocked if the user abandons approval two.
  - Chain-atomic: hold launch while a per-launch ALT/custom-program design is built and independently audited.
- Accept or defer the 8 high and 21 moderate unpatched transitive advisories.
- Merge the isolated branch only after the concurrent Claude worktree is clean and reviewed.
- After all gates pass, request explicit approval for a disposable-wallet mainnet launch and lock.

## Tooling constraints

- Context7 quota is exhausted.
- The in-app Browser is unavailable.
- Local Docker is not running, so migration 004 has static and independent review but not local Postgres execution.
