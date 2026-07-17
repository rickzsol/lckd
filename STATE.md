# Project state

Updated: 2026-07-17

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

## SAS verification

- `npm run typecheck`, `npm run lint`, `npm run build` green. `npm test` 102 passed (40 SAS unit tests).
- Migration applied and exercised against local Postgres 16: idempotent first enqueue, successor parking, completion fence (wrong lease / wrong signature raise), close completion inserts no generation, anon view read allowed / base table denied, and the full two-phase reissue plus its crash-recovery reconciliation all verified.
- `tools/sas-devnet-e2e.ts` extended to exercise the two-phase close-then-recreate path (devnet only; requires funded keys/airdrop, not run in CI).
