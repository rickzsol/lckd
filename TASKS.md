# Tasks

## Repository stabilization

- [x] Preserve the former dirty `trudev` worktree on `rescue/trudev-worktree-20260718` at `bb509a3`.
- [x] Correct the README atomic-launch flow, migration order, and environment-variable reference.
- [x] Consolidate `STATE.md` and `TASKS.md` as tracked project sources of truth.
- [x] Pin Node.js 24.16.0 and npm 11.13.0 across local development and CI.
- [x] Add the Robinhood fork suite and Chromium desktop/mobile Playwright smoke tests to CI.
- [x] Run lint, typecheck, tests, build, and desktop/mobile E2E against the stabilization diff.
- [x] Verify the pull-request quality workflow in hosted CI.
- [x] Verify the full workflow, including the secret-backed Robinhood fork job and Vercel-hosted production deployment, in hosted CI.
- [ ] Normalize mixed CRLF/LF endings in a separate mechanical commit.

## Repository controls

- [x] Resolve the GitHub Actions billing lock so checks and deploys can run.
- [ ] Protect `main`, require review and passing checks, and prevent direct production deployment from non-main workflow dispatches.
- [ ] Protect the Production environment and move Vercel deployment secrets to environment scope.
- [ ] Enable Dependabot alerts and security updates, secret scanning and push protection, CodeQL, and private vulnerability reporting.
- [ ] Choose and add an explicit repository license.

## Launch fees

- [ ] Independently review commit `05f0604` and the current money path before production enablement.
- [ ] QA the fee-enabled preview with a small burn-to-launch, including wallet instructions, finalized receipt persistence, and the burn-ledger row.
- [ ] Choose `LAUNCH_FEE_LAMPORTS`, `LAUNCH_FEE_TREASURY`, `LAUNCH_FEE_WAIVER_LCKD_RAW`, and `LAUNCH_FEE_BURN_DISCOUNT_BPS` for production.
- [ ] Review and apply `supabase/migrations/20260718020000_burn_ledger.sql` to production.
- [ ] Keep production fees disabled until every fee gate above passes.

## Production follow-up

- [ ] Complete the TEST token verify step for mint `Aowscp3jNqDEutohPUNYdCNzobwi3wXnoUi5xqzDG2FH`.
- [ ] Watch the first public atomic launches in Vercel runtime logs and reconcile any ambiguous receipt state.
- [ ] Run a sustained no-spend launch-monitor subscription soak and alert on readiness degradation or repeated reconnects.
- [ ] Configure a production-grade Robinhood archive RPC and verify the authenticated wallet, simulation, recovery, and receipt flow on preview.
- [ ] Keep Robinhood mainnet wallet requests disabled until those checks pass.
- [ ] Track upstream fixes for the 8 high and 21 moderate runtime dependency findings; rerun `npm audit --omit=dev` before release.
- [ ] Verify a controlled Sentry error reaches the configured alerting destination.
- [ ] Complete the owner-authorized Double Counter verification setup.

## Feature integration

- [x] Squash-integrate and independently review holder intelligence at local checkpoint `e8ebaea`.
- [ ] Run a credentialed RicoMaps contract canary plus desktop/mobile browser QA, reconcile current `main`, and open the holder PR.
- [x] Squash-integrate and independently review the trust API and unlock calendar at local checkpoint `e5fd70e`.
- [ ] Execute the trust migration, replay, grant, RLS, and two-session concurrency suite on disposable PostgreSQL 16; run browser QA; reconcile current `main`; and open the trust PR.
- [x] Independently audit `feature/sas-attestations` against the canonical trust layer.
- [ ] Redesign SAS signed evidence, single-writer tier integration, durable desired state, close/reissue serialization, ambiguous transaction recovery, expiry cleanup, and public API contract before integration.
- [ ] Keep `SAS_ENABLED=false` until PostgreSQL concurrency tests, custody preflight, and a real database-plus-worker devnet E2E pass.
- [ ] Integrate the trust-platform phases only after repository stabilization and their independent reviews pass.

## Completed baseline

- [x] Ship the atomic pump.fun create, buy, and Streamflow lock transaction with durable recovery and cleanup.
- [x] Enable public launch entry points and verify the first full atomic pipeline completion.
- [x] Restore the production Supabase data plane and shared distributed rate limiter.
- [x] Deploy the persistent Railway launch monitor and connect the production feed and official token page.
- [x] Map `github_repo` into token display data and ship the submitted-repository card.
- [x] Add privacy-safe Sentry runtime instrumentation.
