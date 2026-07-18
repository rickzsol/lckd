# Project state

Updated: 2026-07-18

## Current status

- `main` is the stabilization baseline `e4a7e2e` plus `f1c335b`: wide-screen token page layout (full-width chart, balanced card grid, fluid contribution graph), the public `/developers` directory, and optimized token/avatar images.
- Public atomic Solana launches are live on [lckd.tech](https://lckd.tech). Production uses Node.js 24.x and the provisioned Supabase data plane; the core atomic-launch and shared-rate-limit paths are active.
- The Railway launch monitor is deployed with persistent state. Its readiness endpoint reports connected, ready, and subscribed, and the official token page and feed consume its verified state.
- The GitHub Actions billing lock is cleared and PR #9 is merged (`9b16e15`). On main pushes the quality job passes end to end (lint, typecheck, 124 tests, build, Chromium smoke), but the `robinhood-fork` job fails closed because the `ROBINHOOD_RPC_URL` repository secret is not configured, and the production deploy job is gated behind it. Until the owner sets that secret, no CI deploy reaches production; lckd.tech still serves the pre-`f1c335b` build.
- The requested `trudev` snapshot is preserved on `rescue/trudev-worktree-20260718` at `bb509a3` (pushed to origin). Its token-page and directory work was re-applied onto current `main` as `f1c335b`; local `trudev/.env.local` now points at lckd-production via Supabase CLI keys.
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
- Set the `ROBINHOOD_RPC_URL` repository secret (owner action; no value exists in any local env) so the fail-closed `robinhood-fork` job and the gated production deploy can run on main pushes. Verified 2026-07-18: runs 29649840661/29649986918 pass quality and fail only this job.
- Review and apply `supabase/migrations/20260718020000_burn_ledger.sql`, complete fee-path preview QA, choose production fee values, and independently review the money path before enabling fees.
- Verify the first public launches in runtime logs and complete the pending TEST token directory verification.
- Keep Robinhood mainnet sending disabled until a production-grade archive RPC is configured and the authenticated preview flow passes.
- Squash-integrate and review `feature/holder-intel`, `feature/trust-api`, and `feature/sas-attestations` from fresh current-`main` branches. Their documented concurrency findings remain release blockers.
- Track upstream dependency fixes and rerun the production audit before each release.
- Choose an explicit repository license. The public repository currently grants no explicit reuse license.
- Normalize mixed CRLF/LF endings in a dedicated mechanical change.
- Finish the Sentry-to-Discord controlled-error check and the owner-authorized Double Counter verification setup.

## Next feature wave

`TRUST_FEATURES_PLAN.md` remains the internal specification for holder intelligence, the public trust API and unlock calendar, webhook-driven lock status, and SAS trust-tier attestations. Implementation branches exist, but stabilization and independent review precede feature integration.
