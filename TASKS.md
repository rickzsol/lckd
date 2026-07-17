# Tasks

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
- [x] Make the access gate fail closed in production when `LCKD_ACCESS_CODE` is unset.

## Release

- [ ] Authorize and configure the Double Counter dashboard, publish the verification panel, and test role assignment with a new account.
- [ ] Restore/provision production Supabase and verify connectivity.
- [ ] Review production data for duplicate receipt signatures and apply migration 002.
- [ ] Configure and validate missing production Pinata, server Helius, origin, Supabase, OAuth, and cron variables.
- [ ] Set `LCKD_ACCESS_CODE` in Vercel; after the fail-closed change deploys, the gate rejects everyone until it is set.
- [ ] Add distributed rate limiting at the deployment or shared data layer.
- [ ] Add durable authenticated recovery for a creation that lands before its lock.
- [ ] Resolve PumpPortal HTTP 400 and pass a live unsigned construction through the strict validator.
- [ ] Deploy a preview and verify OAuth, wallet linking, metadata upload, transaction simulation, receipt persistence, and mobile behavior.
- [ ] Apply migration 005 to a disposable Postgres instance and race recovery state transitions.
- [ ] Configure a production-grade Robinhood RPC/archive endpoint for recovery scans.
- [ ] Verify the authenticated Robinhood wallet and simulation flow on a production-like preview.
- [ ] Run a disposable-wallet end-to-end launch and true time-lock test with explicit spending approval.
- [ ] Track upstream fixes for the remaining production dependency advisories and rerun `npm audit --omit=dev` before release.
