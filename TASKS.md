# Tasks

## Trust platform (full spec in TRUST_FEATURES_PLAN.md) — built on feature branches

Four feature branches built by parallel agents, each through independent Codex review (multiple rounds), all pushed. Not merged; each merges via PR.

- [x] Phase 1a: ricomaps intel API — `feature/intel-api` on nullxnothing/ricomaps. Codex APPROVED, 2379 tests. Needs: apply the mint_scan_queue migration, mint the partner:lckd:production key, measure cold-scan Helius credit cost.
- [x] Phase 1b: holder intelligence client + token page section — `feature/holder-intel`. Review-clean, 78 tests. Needs RICOMAPS_API_URL/KEY pointed at a deployed ricomaps.
- [x] Phase 2: trust API + /unlocks + Helius webhook + lock pipeline — `feature/trust-api`. 199 tests; 1 documented residual in KNOWN_ISSUES.md (backfill_complete MVCC TOCTOU, apply backfill in a maintenance window). Migration unapplied (Supabase offline).
- [x] Phase 3: SAS attestations — `feature/sas-attestations`. 134 tests, PG16-validated; 1 documented residual in KNOWN_ISSUES.md (reissue-vs-close race, needs advisory lock). Gated behind SAS_ENABLED=false; mainnet credential/schema creation still pending.
- [ ] Phase 4: bubble graph widget, feed unlock strip, optional lock-verification Blink.
- [ ] Merge order: intel-api first, then holder-intel (needs the URL), trust-api, then sas-attestations (consumes the trust projection + wires the trust response anchor). Resolve each KNOWN_ISSUES residual before the corresponding feature serves production traffic.

## Completed

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
- [x] Validate Helius parsed/base64 payloads, Pump create/create_v2, Streamflow v13 legacy/create_v2 and Token-2022 locks, stale event ordering, restart epochs, persistence, backfill, and responsive rendering.
- [x] Replace the manual-launch token slug with `/token/lckd` and add an automatically activating CA, chart, market, swap, and lock detail page.
- [x] Route the confirmed official mint permanently to `/token/lckd`, link the feed record, use the launched image, backfill the real Streamflow lock, and verify production counters and token details.

## Release

- [ ] Authorize and configure the Double Counter dashboard, publish the verification panel, and test role assignment with a new account.
- [ ] Restore/provision production Supabase and verify connectivity.
- [ ] Review production data for duplicate receipt signatures and apply migration 002.
- [ ] Configure and validate missing production Pinata, server Helius, origin, Supabase, OAuth, and cron variables.
- [x] Deploy the monitor to Railway with a persistent `/data` volume, `/ready`, allowed origin, start slot, and state path.
- [x] Set Vercel `LAUNCH_MONITOR_URL` and `NEXT_PUBLIC_LAUNCH_MONITOR_URL` to the Railway HTTPS origin and deploy the site to production.
- [x] Replace the Railway Helius credential with an enhanced-WebSocket-capable key and verify the production subscription after redeploy.
- [x] Replay a current Pump create and current Streamflow token lock through the production parsers, fix current v13 lock variants, expose subscription mode, and redeploy Railway plus Vercel.
- [x] Add the exact official Streamflow transaction as a regression fixture and support its current `amountPerPeriod = amount` Token Lock encoding.
- [ ] Add sustained production monitoring and alerting for `/ready` degradation and repeated reconnects.
- [x] Confirm the official non-Mayhem/non-cashback Pump launch from the monitored wallet and the immutable Streamflow lock with the dev wallet as recipient.
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
