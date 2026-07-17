# Production security review

Updated: 2026-07-17

## Decision

**NO-GO for public token launches.** The candidate builds cleanly and the transaction validators passed independent review, but production infrastructure and the two-step launch guarantee still have release-blocking gaps.

## Release blockers

### SEC-001 — High — Production data plane unavailable

- Live `/api/v1/stats` and `/api/v1/feed` return 500.
- Vercel runtime errors show repeated Supabase fetch failures across stats, feed, developer, and cron routes.
- The configured Supabase hostname does not resolve and its project reference is absent from the authenticated Supabase account.
- `PINATA_JWT`, server-only `HELIUS_RPC_URL`, and `ALLOWED_ORIGIN` are not configured in production.

Required: restore/provision Supabase, review data, apply migration 002, set scoped credentials, and verify all backend routes on a preview.

### SEC-002 — High — Mandatory lock is not atomic

- `src/hooks/useTokenLaunch.ts` finalizes Pump creation before requesting a separate Streamflow lock signature.
- Closing or rejecting the second approval leaves a valid Pump token without a lock.
- The app prevents an unlocked token from being persisted/listed, but cannot truthfully guarantee every created token is locked.

Required: implement an atomic/escrowed architecture, or narrow the production guarantee and add durable enforcement/recovery.

### SEC-003 — High — Partial-launch recovery is not durable

- Mint, launch signature, lock transaction state, and signed lock bytes live only in React memory.
- A refresh or crash after Pump finalization removes the retry path.

Required: persist an authenticated server-side launch intent before creation and recover each finalized phase idempotently.

### SEC-004 — High availability — PumpPortal construction currently fails

- Repeated unsigned, unsent `trade-local` creation probes returned HTTP 400, including a funded public fee-payer address and live metadata.
- No transaction was returned for the strict validator.

Required: resolve the current PumpPortal contract/API requirement and pass live unsigned construction before a funded E2E.

### SEC-005 — Medium — Rate limiting is process-local

- `src/lib/api/rateLimit.ts` uses an in-memory `Map`, which is not shared across Vercel instances.

Required: configure Vercel Firewall rate limits or a shared atomic limiter before public traffic.

### SEC-006 — Medium — Dependency advisories remain

- `npm audit --omit=dev`: 5 high, 21 moderate, 0 critical.
- High paths originate in `bigint-buffer`, Solana SPL dependencies, and Streamflow. Automated fixes propose unsafe major downgrades.

Required: track upstream fixes, assess reachability, and document an explicit risk acceptance if no patched compatible versions exist.

## Fixed and independently verified

- Immutable first wallet link with compare-and-set ownership enforcement.
- Exact Pump create/create_v2 and all four current buy layouts from the official IDL.
- Exact signers, fixed programs, PDAs, ATAs, payload lengths, disabled Mayhem/cashback flags, bounded spend, and total compute priority fee.
- Finalized outer-instruction allowlist closes transfer/reacquire purchase-denominator manipulation.
- Finalized Pump TradeEvent binds actual SOL spend and purchased token amount.
- Finalized Pinata IPFS metadata binds name, symbol, description, image, and social links with redirect, host, timeout, and size restrictions.
- Exact Streamflow v13 cliff lock, accounts, fee oracle, permissions, program, payload, finalized debit, and actual deposit percentage.
- Finalized Streamflow deposit must remain at least 50% after protocol fees; the server requires a 51% or greater selected allocation.
- Production RPC requires a server-only URL and verifies the mainnet genesis hash; production Streamflow program ID is pinned.
- Public RLS exposes only fully verified launches and safe profile columns after migration 002.

## Verification

- 16 tests passed
- TypeScript passed
- ESLint passed
- Production build passed
- `git diff --check` passed
- Gitleaks found no committed secrets
- Helius mainnet health and priority-fee reads passed
- Vercel deployment/env/runtime inspection completed
- Context7 was attempted but its monthly quota is exhausted; official Pump, Streamflow, Supabase, Next.js, Helius, and Vercel sources were used
- No transaction was signed or sent
