# Tasks

## Repository stabilization

- [x] Preserve the former dirty `trudev` worktree on `rescue/trudev-worktree-20260718` at `bb509a3`.
- [x] Correct the README atomic-launch flow, migration order, and environment-variable reference.
- [x] Consolidate `STATE.md` and `TASKS.md` as tracked project sources of truth.
- [x] Pin Node.js 24.16.0 and npm 11.13.0 across local development and CI.
- [x] Add the Robinhood fork suite and Chromium desktop/mobile Playwright smoke tests to CI.
- [x] Run lint, typecheck, tests, build, and desktop/mobile E2E against the stabilization diff.
- [x] Fix the audited desktop/mobile UI issues and verify the local dev artifact at 1440px and 390px.
- [x] Restore the token market chart, expose copyable CA and recorded metadata, and optimize token images through Next Image.
- [x] Pin the official feed launch, replace false lock percentages with timestamp-derived progress, polish feed and developer cards on mobile, and add the matched-launch banner.
- [x] Verify the pull-request quality workflow in hosted CI.
- [ ] Verify the full workflow, including the secret-backed Robinhood fork job, in hosted CI.
- [ ] Normalize mixed CRLF/LF endings in a separate mechanical commit.

## Repository controls

- [x] Resolve the GitHub Actions billing lock so checks and deploys can run.
- [ ] Protect `main`, require review and passing checks, and prevent direct production deployment from non-main workflow dispatches.
- [ ] Protect the Production environment and move Vercel deployment secrets to environment scope.
- [ ] Enable Dependabot alerts and security updates, secret scanning and push protection, CodeQL, and private vulnerability reporting.
- [ ] Choose and add an explicit repository license.

## Launch fees

- [x] Implement the exact 0.1 SOL same-transaction LCKD buyback and exact acquired-amount burn path.
- [x] Wire finalized buyback receipt verification, replay-safe combined burn-ledger rows, `/burn`, two lookup tables, and standalone completed-launch ALT cleanup.
- [x] Prove the worst-case atomic transaction stays below the packet cap with exactly three signers.
- [x] Make burn-ledger persistence atomic with launch completion, aggregate lifetime totals across all rows, and fail closed on Pump account rotation.
- [x] Replace the placeholder program ID and independently audit the final compiled program before deployment.
- [x] Define the temporary upgrade-authority policy, deploy and hash-verify the program, initialize PDA token accounts and Pump user-volume, create the reviewed protocol lookup table, and set `BUYBACK_BURN_LOOKUP_TABLE`.
- [x] QA a fee-enabled preview launch with simulation, wallet instruction review, finalized receipt persistence, and the combined burn-ledger row.
- [x] Simulate the complete fee-enabled mainnet-state transaction through the exact LCKD burn without broadcasting a launch.
- [x] Review and apply `supabase/migrations/20260718020000_burn_ledger.sql` to production.
- [x] Review and apply `supabase/migrations/20260718160439_buyback_completed_alt_cleanup.sql` to production.
- [x] Set `LAUNCH_FEE_LAMPORTS=100000000` after deployment and simulation gates passed.
- [x] Transfer program upgrade authority to the verified 2-of-3 Squads multisig vault.
- [x] Commit the exact reviewed release source and record the production deployment-to-revision mapping.
- [ ] Close the deactivated successful-canary ALT from owner wallet `8A4i2yk8R9ivCGdtQeyo71JYyB6CjfSsMnWcYthisPwT` after switching Phantom back to that account.
- [x] Align setup, atomic launch, and cleanup with Phantom's pre-sign simulation and wallet-first co-signing guidance.
- [ ] Submit Phantom's dApp review form if the verified cleanup transaction still shows a warning after deployment.

## Production follow-up

- [ ] Complete the TEST token verify step for mint `Aowscp3jNqDEutohPUNYdCNzobwi3wXnoUi5xqzDG2FH`.
- [x] Reconcile the first fee-enabled public atomic launch through finalized receipt persistence and the public burn ledger.
- [ ] Run a sustained no-spend launch-monitor subscription soak and alert on readiness degradation or repeated reconnects.
- [ ] Configure a production-grade Robinhood archive RPC and verify the authenticated wallet, simulation, recovery, and receipt flow on preview.
- [ ] Keep Robinhood mainnet wallet requests disabled until those checks pass.
- [ ] Track upstream fixes for the 8 high and 21 moderate runtime dependency findings; rerun `npm audit --omit=dev` before release.
- [ ] Verify a controlled Sentry error reaches the configured alerting destination.
- [ ] Complete the owner-authorized Double Counter verification setup.

## Feature integration

- [ ] Squash-integrate `feature/holder-intel` from current `main`, review its timeout/provenance behavior, and open a focused PR.
- [ ] Squash-integrate `feature/trust-api` from current `main` and resolve its documented concurrency finding before opening a PR.
- [ ] Squash-integrate `feature/sas-attestations` from current `main` and resolve its documented concurrency finding before opening a PR.
- [ ] Integrate the trust-platform phases only after repository stabilization and their independent reviews pass.

## Completed baseline

- [x] Ship the atomic pump.fun create, buy, and Streamflow lock transaction with durable recovery and cleanup.
- [x] Enable public launch entry points and verify the first full atomic pipeline completion.
- [x] Restore the production Supabase data plane and shared distributed rate limiter.
- [x] Deploy the persistent Railway launch monitor and connect the production feed and official token page.
- [x] Map `github_repo` into token display data and ship the submitted-repository card.
- [x] Add privacy-safe Sentry runtime instrumentation.
