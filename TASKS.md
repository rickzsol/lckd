# Tasks

## Now

- [ ] QA the launch fee system on preview `trudev-3lbf7zh6m` (fees enabled there: 0.1 SOL, burn discount 20%, waiver 10M LCKD): run a burn-to-launch on /launch-test with a small buy, confirm the burn instruction in the wallet prompt, the finalized receipt recording, and the /burn ledger row. Production keeps fees OFF until these envs are set there deliberately.
- [ ] Decide production fee numbers before enabling: LAUNCH_FEE_LAMPORTS, LAUNCH_FEE_WAIVER_LCKD_RAW (must stay well above typical burn amounts or the burn path is unreachable), LAUNCH_FEE_BURN_DISCOUNT_BPS, and LAUNCH_FEE_TREASURY for the SOL path.
- [ ] Apply supabase/migrations/20260718020000_burn_ledger.sql to production so burn-to-launch rows land in /burn (needs DB password or a fresh management token).
- [ ] Independent review of commit 05f0604 (money path) before enabling fees in production.

- [ ] Complete the TEST token verify step in the wizard so `Aowscp3jNqDEutohPUNYdCNzobwi3wXnoUi5xqzDG2FH` records to the directory (owner action).
- [x] Map `github_repo` into `tokenToDisplay` so the Submitted repository card renders on token pages (live 2026-07-18, cached repo details + 30-day commit count, hidden on owner mismatch).
- [ ] Resolve the GitHub Actions billing lock so CI deploys work again (owner action); until then deploy via `vercel deploy --prod` from the launch-fix-dev worktree.
- [ ] Reconcile or discard the uncommitted two-step revert sitting in the `trudev` worktree on stale local main.
- [ ] Watch the first public launches in Vercel runtime logs; the atomic pipeline has exactly one full success so far.
- [ ] Normalize line endings repo-wide (mixed CRLF/LF causes full-file diffs).

## Completed 2026-07-17/18 (atomic launch go-live)

- [x] Fix ALT cleanup: accept Phantom guard/compute-budget instructions semantically and treat zero-lamport lookup-table tombstones as closed.
- [x] Replace client-reachable BigInt Buffer methods with DataView helpers so browser bundles stop crashing at signing.
- [x] Fix finalized atomic receipt verification for jsonParsed instruction shapes and the Streamflow default payer; first launch recorded end to end.
- [x] Enable public launches: env flag honored in production, live launch buttons in navbar, hero, and closing CTA.
- [x] Rebuild the official LCKD token record in the new Supabase project from on-chain receipts; feed and token page live.
- [x] Fix `/token/<mint>` 404 (uuid cast error) and rebalance the token page layout; verified desktop + mobile via Playwright.
- [x] Rewrite `/docs` for the atomic create-and-lock flow.
- [x] Fast-forward `main` to the deployed branch so pushes cannot roll back production.

## Planned: trust platform (full spec in TRUST_FEATURES_PLAN.md)

- [ ] Phase 1: build the ricomaps intel API in cabal-visualizer (shaper, /api/v1/intel routes, partner key script, spec doc) and add the LCKD client, proxy route, and token page holder intelligence section.
- [ ] Phase 2: apply migration 006 (locks + attestations tables with backfill), ship the public trust API and /unlocks calendar with per-route public CORS, and add the Helius webhook receiver plus nightly lock sweep.
- [ ] Phase 3: run the SAS devnet end-to-end, create the mainnet credential and schema with a cold issuer key, wire attestation issuance into launch verification and the tier cron, and surface attestations on token pages and api-docs.
- [ ] Phase 4: bubble graph widget, feed unlock strip, optional lock-verification Blink.

## Completed

- [x] Stage privacy-safe Sentry runtime error instrumentation for browser, Node.js, and edge runtimes and pass the full local quality gates.
- [x] Reset and harden the LCKD Discord server with gated channels, private alerts, repaired AutoMod, controlled invites, and Double Counter role hierarchy.
- [x] Install and verify the project-local Discord administration MCP for the LCKD guild.
- [x] Upgrade the application stack and regenerate the lockfile.
- [x] Replace stale metadata upload, launch, lock, verification, and retry paths.
- [x] Enforce exact PumpPortal and Streamflow transaction semantics before signing.
- [x] Enforce finalized on-chain verification before recording a launch.
- [x] Require GitHub authentication and signed linked-wallet ownership before launch.
- [x] Remove production mock data, unsafe fee-claim transaction handling, stale prototype files, and the obsolete public PRD.
- [x] Rewrite README, product docs, API reference, risk disclosure, metadata, robots, and sitemap.
- [x] Add security headers, server-only Supabase writes, origin checks, input validation, and safe external URL handling.
- [x] Add time-lock and PumpPortal transaction tests.
- [x] Pass lint, type checks, tests, production build, secret scan, and desktop/mobile browser QA.
- [x] Validate exact current Pump create/create_v2 and four buy layouts before signing and after finalization.
- [x] Bind finalized Pump TradeEvent spend, token delta, immutable IPFS metadata, and Streamflow debit to persisted records.
- [x] Independently review authentication, on-chain invariants, production deployment, and final security fixes.
- [x] Research Robinhood Chain launch activity and select Pons as the primary Pump.fun-style launch path.
- [x] Pin and verify the live Pons deployment, configuration, ownership, fee routing, and runtime bytecode.
- [x] Prove paid-buy and zero-buy Pons launches on a pinned Robinhood fork with LP NFT locker ownership.
- [x] Add a mainnet-disabled Robinhood launch UI with injected wallet simulation and post-receipt verification.
- [x] Add durable Robinhood recovery with stable salts, exact transaction checkpoint validation, ambiguous outcomes, replacement discovery, and 20-confirmation verification.
- [x] Prove same-salt and two-broadcast Pons idempotency on a pinned Robinhood fork.
- [x] Run a full production mobile review (390/360px) across all routes; fix footer overlay on the coming-soon gate, docs anchor overshoot, footer tap targets, and wallet button casing.
- [x] Add Mobile Wallet Adapter support for Android Chrome via `@solana-mobile/wallet-standard-mobile`.
- [x] Remove the temporary access gate and its shared credential before public release.
- [x] Audit GitHub history, repository settings, workflows, public copy, assets, dependency advisories, and tracked operational files.
- [x] Rewrite the README around current Solana and Robinhood flows and use the tracked OG asset.
- [x] Remove internal state/audit/generated files from tracking, harden ignore rules, strip public image metadata, and harden the deployment workflow.
- [x] Research ClawPump's February 2026 launch-era X sequence and replace the repetitive LCKD post-launch drafts with a proof-led, release-gated launch-week plan.
- [x] Add the official Pump launch and Streamflow lock monitor, SSE client, `/feed` CA panel, and homepage live counters.
- [x] Validate Helius parsed/base64 payloads, Pump create/create_v2, Streamflow v13 legacy/Token-2022 locks, stale event ordering, restart epochs, persistence, backfill, and responsive rendering.
- [x] Replace the manual-launch token slug with `/token/lckd` and add an automatically activating CA, chart, market, swap, and lock detail page.

## Release

- [ ] Merge and deploy the Sentry instrumentation draft PR, add a scoped source-map upload token, and verify the Sentry-to-Discord incident path with a controlled error.
- [ ] Authorize and configure the Double Counter dashboard, publish the verification panel, and test role assignment with a new account.
- [ ] Restore/provision production Supabase and verify connectivity.
- [ ] Review production data for duplicate receipt signatures and apply migration 002.
- [ ] Configure and validate missing production Pinata, server Helius, origin, Supabase, OAuth, and cron variables.
- [x] Deploy the monitor to Railway with a persistent `/data` volume, `/ready`, allowed origin, start slot, and state path.
- [x] Set Vercel `LAUNCH_MONITOR_URL` and `NEXT_PUBLIC_LAUNCH_MONITOR_URL` to the Railway HTTPS origin and deploy the site to production.
- [x] Replace the Railway Helius credential with an enhanced-WebSocket-capable key and verify the production subscription after redeploy.
- [ ] Run a sustained no-spend production subscription soak before launch.
- [ ] Before the main launch, confirm Mayhem/cashback are disabled and create directly from the monitored dev wallet; lock through Streamflow with the connected dev wallet as recipient.
- [ ] Apply migration 003 so the shared production rate limiter is available.
- [ ] Deploy a preview and verify OAuth, wallet linking, metadata upload, transaction simulation, receipt persistence, and mobile behavior.
- [ ] Apply migration 005 to a disposable Postgres instance and race recovery state transitions.
- [ ] Configure a production-grade Robinhood RPC/archive endpoint for recovery scans.
- [ ] Verify the authenticated Robinhood wallet and simulation flow on a production-like preview.
- [ ] Run a disposable-wallet end-to-end launch and true time-lock test with explicit spending approval.
- [ ] Track upstream fixes for the remaining production dependency advisories and rerun `npm audit --omit=dev` before release.
- [ ] Resolve the GitHub Actions billing lock, protect `main`, require CI/review, protect the Production environment, and move Vercel secrets to environment scope.
- [ ] Enable Dependabot alerts/security updates, secret scanning/push protection, CodeQL, and private vulnerability reporting in repository settings.
- [ ] Reconcile and delete `codex/production-hardening`; decide whether to rewrite history for internal documents, AI co-author trailers, and the legacy email.
- [ ] Reconcile `codex/launch-replay-hotfix` with the production monitor routes before its next production deployment can overwrite them.
- [ ] Choose and add an explicit license.
