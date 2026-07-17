# Project state

Updated: 2026-07-17 (SAS round 3 confirmation fixes)

## Status

Production release approved after independent security review and deployed at `https://lckd.tech` from commit `b125e42`. Production Supabase is migrated through `007_atomic_cleanup_races.sql`, required Vercel environment variables are configured, and the atomic launch path is live. No transaction has been signed or sent.

## Launch invariants

- Approval one creates and extends one exact address lookup table.
- Approval two atomically creates the Pump token, executes the reviewed exact-token buy, deposits the selected amount into an immutable Streamflow v13 cliff lock, and deactivates the lookup table.
- The wallet, mint, and Streamflow metadata keypairs are the only signers; private keys remain in browser memory.
- Finalized receipts, exact messages, blockhashes, signer vectors, accounts, instruction data, quote/spend bounds, lock amount, and unlock time are verified before recording.
- Confirmed or finalized uncheckpointed transactions are reconciled before cleanup; still-processing transactions block cleanup.
- Lookup-table close is wallet-authorized after SlotHashes cooldown and returns rent to the wallet.

## Production infrastructure

- Supabase production: `lzxdqxtsceizopjqqxdb`, migrations 001-007 applied, schema lint clean, performance advisor clean.
- Supabase staging: `tmkrxqjaoarmjyyjlxqk`, migrations 001-007 applied and lint clean.
- Vercel production env includes Supabase, Helius, Pinata, GitHub OAuth, NextAuth, `ALLOWED_ORIGIN`, and mainnet Streamflow configuration.
- Public landing statistics use aggregate database data; production currently reports zero launches, locked tokens, verified developers, and active builders.
- LCKD is listed separately as a manual token announcement with the user-supplied `pfp-3c.png`; its CA remains unset until launch.

## Verification

- 62 tests passed.
- TypeScript, ESLint, production build, and `git diff --check` passed.
- Independent atomic SQL, recovery, on-chain receipt, UI lifecycle, and deployment reviews passed.
- Production and staging aggregate RPC checks passed; anonymous atomic mutations are denied.
- Live production home, feed, LCKD detail, image, stats, auth gates, and security headers passed.
- Gitleaks found no committed or source/migration secrets.
- `npm audit --omit=dev`: one underlying unpatched `bigint-buffer` advisory represented by 8 dependency nodes; 0 critical and 0 moderate.

## Remaining operational check

- Run one disposable-wallet mainnet launch only after the user supplies an explicit SOL spending cap. This is optional post-deploy validation and is the only step that spends funds.

## SAS attestations (feature/sas-attestations, review fixes)

- Independent review returned CHANGES REQUESTED; all 12 findings addressed on this branch.
- Issuance now enqueues from the finalized-lock record path and the tier-recompute cron, both behind `SAS_ENABLED` (default off). Trust-projection seam stays marked for `feature/trust-api`.
- Outbox worker drives jobs from live chain state (skip/issue/reissue/close decided from the full payload + expiry). Reissue is two durable phases (close then create), each with its own persisted signature and reconciliation; a single close+create tx is intentionally not used.
- Completion RPCs fence on lease token, status, and persisted signature before any attestation mutation; a stale worker cannot land or commit effects. Close completion never inserts a false generation.
- Public reads go through an owner-executed, tightly projected `attestations_public` view (no base-table grant/policy). Enqueue is atomic (insert-on-conflict) and parks a successor snapshot when trust changes during in-flight work.
- Verifier rejects paused schemas and requires payload `cliff_ts == account.expiry`; the `/api-docs` example mirrors both. RPC is cluster-specific and genesis-hash-checked before signing.

## SAS attestations round 3 (feature/sas-attestations)

- 2a: broadcast recovery preserves the claimed-from status (`claim_attestation_job` keeps `broadcast`, not `leased`), so the reconciliation completion RPCs no longer raise; the mark RPCs accept a re-driven broadcast row. `RETURN QUERY` was already in place.
- 2b: a signature counts as landed only at FINALIZED. A confirmed-but-not-finalized signature waits (backs off, reconciles the same signature later) rather than advancing or re-driving, so a fork rollback can never leave a phantom generation or an advanced reissue phase.
- 5: the parked successor slot holds only the latest desired state. Refreshing a pending job's live desired columns clears any stale successor, and an enqueue that returns the desired state to the in-flight claim clears it too, so completion never promotes a stale snapshot over a newer one.
- 10: the lost-insert fallback uses `INSERT ... ON CONFLICT` on the partial open-job index, so a concurrent enqueue can no longer raise 23505.
- 1: the tier-recompute cron reissues on a policy or schema version bump, not only a tier change. `getTrustAnchorDescriptor` (program id, credential/schema PDA, attestation PDA, expiry, versions) is the documented interface this branch hands the trust API; the response wiring is `TODO(trust-api)` and lives on feature/trust-api, not merged here.
- NEW: an expired-lock downgrade enqueues a CLOSE-ONLY job (`triggerExpiredLockClose`), never a reissue, so a past-expiry create can no longer dead-letter after the close succeeds.
- 12: the worker asserts `job.cluster === ctx.config.cluster` before signing; a mismatch fails permanently without broadcasting, so a devnet job queued across a switch to mainnet cannot issue on mainnet with a devnet label.

## SAS verification (round 3)

- `npm run typecheck`, `npm run lint`, `npm run build` green. `npm test` 116 passed (49 SAS unit tests, incl. worker finalization-wait, cluster-mismatch, close-only, and anchor-seam cases).
- Migration re-applied and exercised against local Postgres 16 via `supabase/tests/attestation_outbox_rpcs.test.sql`: broadcast recovery preserves status and completes, parked-successor latest-wins across a reissue advance, return-to-inflight clears the successor, and the lost-insert ON CONFLICT stays idempotent.
- `tools/sas-devnet-e2e.ts` still covers the two-phase close-then-recreate path (devnet only; requires funded keys/airdrop, not run in CI).
