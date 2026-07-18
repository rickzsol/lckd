# Project state

Updated: 2026-07-18

## Current status

- `origin/main` is `e4a7e2e` and is the baseline for the repository stabilization branch.
- Public atomic Solana launches are live on [lckd.tech](https://lckd.tech). Production uses Node.js 24.x and the provisioned Supabase data plane; the core atomic-launch and shared-rate-limit paths are active.
- The Railway launch monitor is deployed with persistent state. Its readiness endpoint reports connected, ready, and subscribed, and the official token page and feed consume its verified state.
- The GitHub Actions billing lock is cleared. Pull request #9 passed the hosted quality workflow; repository protections remain pending owner authorization.
- The requested `trudev` snapshot is preserved on `rescue/trudev-worktree-20260718` at `bb509a3`. Subsequent developer, profile, and token UI edits remain local for separate review.
- Holder intelligence is preserved locally on `integration/holder-intel` at `e8ebaea`; its provider-contract, quota, retry, mobile, and accessibility reviews are clean. A live provider canary and browser QA remain required before a PR.
- The trust API and unlock calendar are preserved locally on `integration/trust-api` at `e5fd70e`; 307 tests, lint, typecheck, build, independent review, and secret scanning pass. Executable PostgreSQL 16 migration, grant, RLS, replay, and two-session concurrency tests remain required before a PR or migration.
- The SAS attestation branch was independently audited and remains disabled. Its signed-supply, tier-authority, durable-enqueue, close/reissue, transaction-recovery, expiry, and public-contract blockers require redesign on top of the verified trust layer.
- Production launch fees remain disabled. The fee preview, burn-ledger migration, production values, and independent money-path review are still gates.

## Verified launch model

- A Solana launch uses two wallet approvals. The first creates and extends a dedicated address lookup table.
- The second approval signs one atomic transaction containing pump.fun token creation, the initial buy, the Streamflow lock, and lookup-table deactivation.
- The setup transaction cannot create the token. Creation, purchase, and locking finalize together or do not execute.
- Client validation, signed-message integrity checks, simulation, finalized receipt verification, and persistence enforce the same mint, wallet, metadata, amount, fee, and lock invariants.
- Recovery checkpoints reconcile submitted transactions without issuing a conflicting launch. Lookup-table closure is a separate cleanup action after the cooldown.
- Robinhood Chain launches remain experimental and mainnet wallet requests default to disabled. Pons deployment checks, durable intent recovery, replacement discovery, and 20-confirmation receipt verification are implemented.
- Wallets remain the only transaction signers. Server credentials are limited to privileged reads, verified persistence, indexing, and recovery state.

## Quality baseline

- The main baseline passed lint, typecheck, unit/integration tests, the six-test pinned Robinhood fork suite, and the production build before stabilization began.
- Desktop and mobile production behavior has been checked manually with Playwright, including responsive navigation, overflow, console errors, and reduced motion.
- The stabilization change passed the hosted Node.js 24.16.0/npm 11.13.0 quality workflow, including lint, typecheck, 124 unit/integration tests, a production build, and eight Chromium desktop/mobile smoke checks.
- The latest production dependency audit reported 8 high and 21 moderate transitive runtime findings in the Solana, Pump, and Streamflow trees. Automated forced fixes are not considered safe.

## Open release gates

- Require CI and review on `main`, protect the Production environment, and scope deployment secrets to that environment.
- Verify the secret-backed Robinhood fork job after the stabilization change reaches `main`; pull requests intentionally skip that job.
- Review and apply `supabase/migrations/20260718020000_burn_ledger.sql`, complete fee-path preview QA, choose production fee values, and independently review the money path before enabling fees.
- Verify the first public launches in runtime logs and complete the pending TEST token directory verification.
- Keep Robinhood mainnet sending disabled until a production-grade archive RPC is configured and the authenticated preview flow passes.
- Run a credentialed RicoMaps provider canary and browser QA before publishing the holder-intelligence checkpoint.
- Run the trust migration and two-session concurrency suite against disposable PostgreSQL 16, then browser QA, before publishing the trust checkpoint.
- Redesign SAS attestations against canonical lock evidence and the single trust-tier authority; keep `SAS_ENABLED=false` until its database, recovery, custody, and devnet gates pass.
- Track upstream dependency fixes and rerun the production audit before each release.
- Choose an explicit repository license. The public repository currently grants no explicit reuse license.
- Normalize mixed CRLF/LF endings in a dedicated mechanical change.
- Finish the Sentry-to-Discord controlled-error check and the owner-authorized Double Counter verification setup.

## Next feature wave

`TRUST_FEATURES_PLAN.md` remains the internal specification for holder intelligence, the public trust API and unlock calendar, webhook-driven lock status, and SAS trust-tier attestations. Holder and trust checkpoints are reviewed locally but remain gated from publication and deployment; SAS requires redesign.
