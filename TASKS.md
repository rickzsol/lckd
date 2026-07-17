# Tasks

## Completed

- [x] Upgrade the application stack and regenerate the lockfile.
- [x] Replace stale metadata upload, launch, lock, verification, and retry paths.
- [x] Enforce exact Pump SDK and Streamflow transaction semantics before signing.
- [x] Enforce finalized on-chain verification before recording a launch.
- [x] Require GitHub authentication and signed linked-wallet ownership before launch.
- [x] Remove production mock data, unsafe fee-claim transaction handling, stale prototype files, and the obsolete public PRD.
- [x] Rewrite README, product docs, API reference, risk disclosure, metadata, robots, and sitemap.
- [x] Add security headers, server-only Supabase writes, origin checks, input validation, and safe external URL handling.
- [x] Add time-lock and Pump transaction tests.
- [x] Pass lint, type checks, tests, production build, secret scan, and desktop/mobile browser QA.
- [x] Validate exact current Pump create/create_v2 and four buy layouts before signing and after finalization.
- [x] Bind finalized Pump TradeEvent spend, token delta, immutable IPFS metadata, and Streamflow debit to persisted records.
- [x] Independently review authentication, on-chain invariants, production deployment, and final security fixes.

## Release

- [ ] Restore/provision production Supabase and verify connectivity.
- [ ] Review production data for duplicate receipt signatures and apply migration 002.
- [x] Configure and validate production Pinata, server Helius, and allowed origin.
- [x] Add distributed rate limiting at the shared data layer.
- [x] Add durable authenticated recovery for a creation that lands before its lock.
- [x] Replace broken PumpPortal construction and pass official Pump SDK live unsigned simulation.
- [x] Deploy a protected Vercel Preview and pass its production build.
- [ ] Configure valid staging and production Supabase projects.
- [ ] Apply migrations 002, 003, and 004 to staging and run database integration tests.
- [ ] Verify Preview OAuth, wallet linking, metadata upload, recovery, and finalized persistence.
- [ ] Choose listing-gated locking or hold for a chain-atomic ALT/custom-program launcher.
- [ ] Run a disposable-wallet end-to-end launch and true time-lock test with explicit spending approval.
- [ ] Track upstream fixes for the remaining production dependency advisories and rerun `npm audit --omit=dev` before release.
