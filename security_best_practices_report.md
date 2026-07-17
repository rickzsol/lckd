# Production security review

Updated: 2026-07-17

## Decision

**NO-GO for public token launches.** Code-side blockers are addressed in the isolated release candidate, but production Supabase is unavailable and the product owner must explicitly choose between listing-gated two-step locking and a future chain-atomic launcher.

## Open release blockers

### SEC-001 - High - Production data plane unavailable

- Production stats and feed safely return `available: false`.
- The configured Supabase host no longer resolves and the project is not visible to the authenticated CLI account.
- Apply migrations 002, 003, and 004 only after restoring the intended project, reviewing existing rows, and running a dry-run.
- Production `PINATA_JWT`, `HELIUS_RPC_URL`, and `ALLOWED_ORIGIN` are now validated and configured.

### SEC-002 - High - Locking is listing-gated, not chain-atomic

- LCKD never records or publishes a launch until both finalized receipts pass exact verification.
- Pump creation and Streamflow locking still require separate wallet approvals. A user can abandon the second approval and leave a Pump token unlocked outside LCKD.
- A direct v0 transaction does not fit. A reusable fixed-address lookup table still measures 1,251-1,289 bytes, above Solana's 1,232-byte limit.
- A prepared per-launch lookup table fits at 910-1,082 bytes and should remain a separate audited project because it needs dynamic ALT preparation and low-level Streamflow construction.

Required: explicitly accept the honest listing-gated guarantee for this release, or hold launch for an independently audited ALT/custom-program atomic implementation.

### SEC-003 - Medium - Database recovery must be exercised on staging

- The candidate persists an authenticated intent before returning a transaction, checkpoints signatures before broadcast, reconciles finality, and restores mandatory-lock state after refresh.
- State transitions use atomic compare-and-swap RPCs. Token persistence and intent completion share one database transaction.
- Metadata and reviewed lock percentage are bound to finalized receipts. A 100% intent cannot be recorded with a 51% lock.
- SQL integration tests cannot run until a disposable Supabase project is provided; local Docker is unavailable.

Required: apply migrations to staging and run concurrency, replay, rollback, expiry, OAuth, and recovery tests before production.

### SEC-004 - Medium - Dependency advisories remain

- `npm audit --omit=dev`: 8 high, 21 moderate, 0 critical.
- The official Pump SDK adds findings through the existing Solana/Anchor dependency tree. Automated fixes propose incompatible downgrades.

Required: record risk acceptance and track upstream patched releases.

## Fixed and independently verified

- Broken PumpPortal creation was replaced with official `@pump-fun/pump-sdk@1.36.0` construction.
- Live unsigned mainnet simulation passed: 1,162 bytes, 5 instructions, 2 signers, 0 ALTs, 198,375 CU, `err=null`.
- Exact Pump account layouts, official fee recipients, PDAs, ATAs, signers, spend, priority fee, and outer instructions are validated.
- Distributed rate limiting uses an atomic service-role-only Postgres RPC and fails closed in production.
- Durable recovery uses immutable prepared intents, CAS checkpoints, expiry-safe abandonment, and one-active-intent enforcement.
- Exact Streamflow v13 cliff, permissions, fee oracle, PDAs, finalized debit, and requested lock allocation are verified.
- GitHub identity, immutable wallet ownership, metadata, launch receipt, lock receipt, and persisted row must agree.
- Security headers, origin checks, bounded metadata fetching, RLS, and server-only writes remain enforced.

## Verification

- 21 tests passed
- TypeScript passed
- ESLint passed
- Production build passed locally and on Vercel Preview
- Independent Pump, atomic-feasibility, rate-limit, and recovery reviews completed
- Gitleaks source-tree scan found no secrets
- Context7 was attempted but quota is exhausted; official primary sources and installed SDK source were used
- In-app Browser is unavailable in this session
- No transaction was signed or sent
