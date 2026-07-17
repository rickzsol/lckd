# Project state

Updated: 2026-07-17

## Planning

TRUST_FEATURES_PLAN.md (internal, gitignored) specifies the next feature wave: SAS trust-tier attestations, a public trust API with an /unlocks calendar and webhook-driven lock status, and ricomaps-backed holder intelligence on token pages. Research and both-repo recon are complete; implementation has not started. Phases 2 and 3 depend on the Supabase restore and migrations 002/003 listed under release gates.

## Latest change

UI polish pass (2026-07-17): `/token/lckd` and `/token/[id]` widened to a 1360px shell with scaled header, stats, chart heights, and a 380/420px sidebar; chart and swap pending states redesigned (mascot empty state, no dead voids). `/launch` wizard now renders inside a surface card with a single refined stepper (duplicate progress bar removed), a step counter in the page header, a full-width image dropzone, and a structured preview row with replace/remove. The wizard UI was extracted to `src/app/launch/WizardPanel.tsx`. The GitHub step was redesigned: real avatar identity card, repo activity proof card with recent commits from the new authenticated `GET /api/v1/github/activity?repo=owner/name` endpoint (own-repo only, rate limited), and a four-tier profile ladder with next-step hints (`src/app/launch/githubProof.tsx`). A dev-only `/demo` route (404 in production) renders both token pages and the full wizard with fixture data, live DexScreener market data for a real mint, and a launch-outcome state switcher. Design docs in `.design/token-launch-polish/`. Typecheck and lint clean.

## Status

The official launch monitor and token page are deployed to production. The broader authenticated launch flow is not approved for production use because its Supabase data plane remains offline. No mainnet transaction or database migration was executed during this work.

## Verified behavior

- Launch uses two explicit wallet approvals: pump.fun create and buy, then Streamflow lock.
- The Streamflow v13 instruction is a cliff-based token lock. Unlockable amount is zero before the selected timestamp and the full locked amount at that timestamp.
- The lock is non-cancelable, non-transferable, cannot be topped up, cannot be paused, cannot change rate, and does not auto-withdraw.
- Browser construction, pre-sign instruction decoding, finalized chain verification, and persisted receipt checks enforce the same lock invariants.
- Retry rebroadcasts the same signed lock transaction and checks the metadata account before permitting a rebuild.
- GitHub identity, signed wallet ownership, selected wallet, launch receipt, mint configuration, and lock receipt must agree before persistence.
- Public data is shown as unavailable or unverified when its source cannot be confirmed. No production mock fallback remains.
- The official launch monitor watches wallet `3XyvG1HC1QvzHmNFejUzGgbj8YCLqDRKcoyrWZPuR7p8` from slot `433501410`, validates exact Pump create/create_v2 transactions, and publishes processed then confirmed CA state over SSE.
- The same worker validates immutable Streamflow v13 manual locks for the detected mint, including Token-2022 account layouts, and publishes lock amount, percentage, contract, and unlock time.
- Monitor state has atomic optional volume persistence, full backfill to the configured start slot, parsed/base64 Helius payload support, WebSocket and subscription liveness checks, finalized-fork reconciliation, and a 503 readiness endpoint.
- `/feed` displays the official CA and lock state outside the database directory flow. Homepage launch, locked, and verified counters merge the confirmed official launch state even while Supabase is unavailable.
- The permanent official-token route is `/token/lckd`; `/token/lckd-manual-launch` redirects permanently. The page reveals the CA, Pump/Orb/Jupiter links, DexScreener chart, 15-second market data, and Streamflow lock state from the same live monitor without a refresh.
- Pump create/create_v2 and all four current buy variants use exact official account, PDA, ATA, program, payload, signer, and spend validation.
- Finalized launch verification rejects extra outer programs and binds the Pump TradeEvent, actual token purchase, metadata document, and persisted SOL spend.
- Wallet linking is immutable after the first verified link.
- Robinhood Chain launches use the live Pons factory on chain 4663. The integration pins the factory, locker, WETH, Uniswap factory, position manager, router, ownership, fee split, launch configuration, and runtime bytecode hashes.
- Pons launches create a fixed 1 billion token supply and transfer the Uniswap v3 LP NFT to the pinned locker in one transaction. The creator fee and initial-buy token recipient is explicit and post-verified.
- Robinhood launch construction rechecks the pinned deployment before simulation and immediately before wallet write, then verifies the factory record, token state, LP NFT owner, fee redirect, and fee split after confirmation.
- Robinhood recovery persists the canonical form and salt before wallet approval, validates candidate hashes against the exact sender/factory/value/calldata before binding, and reconciles replacements from indexed Pons events.
- Unknown wallet outcomes enter a non-expiring ambiguous state that blocks further wallet requests. Submitted and ambiguous attempts cannot be reset; verified results require 20 sequencer confirmations.
- Manual recovery that discovers an under-confirmed transaction continues through confirmation and final reconciliation in the same single-flight action, without opening another wallet request.
- Robinhood mainnet sending is disabled unless `NEXT_PUBLIC_ENABLE_ROBINHOOD_LAUNCHES=true`. Public profile record persistence is not active.

## Verification completed

- Sentry runtime error instrumentation is staged for browser, Node.js, and edge runtimes with PII, request-body capture, tracing, replay, and log forwarding disabled. The Vercel DSN is configured; activation awaits human merge and deployment.
- LCKD Discord was reset and hardened: fresh gated channels, private security logs, Medium verification, full media filtering, four repaired AutoMod rules, expiring invites only, and Double Counter above `Verified`. The owner-authorized Double Counter panel is still pending.
- Project-local `discord_admin` MCP is pinned to `@quadslab.io/discord-mcp@2.1.1`, scoped to guild `1519763437738135632`, and verified with an authenticated guild read.
- `npm test`: 58 passed
- `npm run test:robinhood`: 6 pinned-fork launch and idempotency tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed with Next.js 16.2.10
- Live Helius enhanced-WebSocket smoke passed with a transient clipboard credential: the exact dev-wallet subscription and Pump traffic subscription were accepted, and a real transaction notification normalized successfully. The key was not persisted or printed.
- Playwright: desktop and mobile routes, responsive menu, reduced motion, no horizontal overflow, no page console warnings
- Gitleaks: 26 commits plus the full local candidate scanned, no leaks
- Independent authentication, on-chain, deployment, recovery-state, and final patch reviews completed with no critical or high Robinhood findings
- Full mobile review of production lckd.tech (390px and 360px): all routes render without horizontal overflow or console errors; footer overlay on the coming-soon gate reproduced in production and confirmed fixed by the local SiteFooter refactor
- Mobile wallet support added: `@solana-mobile/wallet-standard-mobile@0.5.3` registers MWA for Android Chrome (chain inferred from RPC endpoint); iOS uses the existing Phantom/Solflare universal-link redirects
- The access gate and coming-soon route were removed from the public candidate; no shared access credential remains.
- Docs mobile section navigator no longer overshoots anchors (dropdown collapses via flushSync before scroll; headings use scroll-mt-36 on mobile)
- Live read-only Pons deployment verification and historical receipt verification passed
- Public-repository audit completed: README uses the OG asset, stale launch claims were corrected, Canva metadata was stripped from public PNGs with no pixel changes, and internal state/audit files are ignored and staged for removal from the public tree.
- The local deploy workflow now uses read-only permissions, SHA-pinned actions, an exact Vercel CLI version, quality gates, a production environment binding, and serialized deploys. Dependabot configuration is present.
- The post-launch X plan now uses a gated 12-post launch-week sequence based on a 40-post ClawPump launch sample. Unsupported buyback, public API, team, and integration claims were removed; every metric and future claim requires public proof.
- Railway deployment `f37e3fba-eed3-44d9-81e4-8da2cbdc74ec` is healthy at `https://lckd-launch-monitor-production.up.railway.app`, with persistent `/data` state, `/ready` reporting connected/ready/subscribed, and the official wallet/start slot configured.
- Vercel production deployment `dpl_7Qhvx5VbVyfLBNJbNWKn5UfZELzN` is Ready and aliased to `https://lckd.tech`. It restored the monitor build after a later CLI deployment from `codex/launch-replay-hotfix` temporarily replaced it. Production QA verified `/token/lckd`, the `308` legacy redirect, Railway CSP, live monitor reads, desktop/mobile layout, and no console errors.

## Known release gates

- Merge and deploy the Sentry instrumentation draft PR, add a scoped `SENTRY_AUTH_TOKEN` for source-map uploads, then verify a controlled error reaches Sentry and the private Discord incident channel.
- Authorize the Double Counter dashboard, bind `#verify`, `@Verified`, and `#verification-logs`, then publish and test its verification panel.
- Restore or provision the production Supabase project. The configured host no longer resolves; live stats/feed return `available: false` and cron cannot refresh data.
- Configure and validate `PINATA_JWT`, `HELIUS_RPC_URL`, `ALLOWED_ORIGIN`, Supabase, OAuth, and cron production values. Do not reuse credentials from another project without an explicit rotation decision.
- Review existing production rows, then apply `supabase/migrations/002_backend_hardening.sql`.
- Accept or redesign the non-atomic Solana flow: Pump creation finalizes before a separate lock approval. Durable recovery reduces interruption risk but cannot roll back a finalized creation.
- Apply `supabase/migrations/003_distributed_rate_limits.sql`; production throttling fails closed until the shared limiter exists.
- Deploy this commit to a preview and verify OAuth, wallet linking, metadata upload, RPC, finalized persistence, and runtime logs.
- Apply `supabase/migrations/005_robinhood_launch_recovery.sql` to a disposable database and run concurrent prepare/ambiguous/checkpoint/replacement transition tests before production.
- Keep Robinhood mainnet sending disabled until migration 005 is applied, the authenticated preview flow passes, and a production-grade Robinhood RPC/archive provider replaces the rate-limited public endpoint.
- Verify the full authenticated Robinhood wallet flow on a preview; local dev NextAuth remained in its loading state during browser QA.
- Production dependency audit reports 8 high and 21 moderate transitive findings in the existing Solana/Pump/Streamflow dependency trees. Suggested automated fixes are unsafe downgrades or unavailable upstream fixes.
- An owner must protect `main`, require review/checks, protect the Production environment, move deployment secrets to it, enable Dependabot/security scanning, and resolve the GitHub Actions billing lock.
- Reconcile and delete the diverged public `codex/production-hardening` branch. History rewriting for old internal files, AI co-author trailers, and the exposed legacy email requires explicit coordinated approval.
- Choose an explicit repository license before granting public reuse rights.
- After every gate above is green, run a disposable-wallet mainnet launch and lock. This needs explicit approval because it spends funds.
- Context7 documentation lookup is unavailable until its monthly quota resets; official primary documentation was used instead.
- Railway now uses verified Helius credential fingerprint `9f59184996`. The exact production `transactionSubscribe` payload passed repeatedly before installation, deployment `03538aaa-9a07-4901-af47-9a20f2049028` reached SUCCESS, `/ready` reports connected/ready/subscribed, and runtime logs show no fallback subscription error.
- Run a sustained no-spend production subscription soak before launch and alert on `/ready` degradation or repeated reconnects.
- The main Pump launch must be direct from the monitored wallet with Mayhem and cashback disabled. The manual Streamflow time lock must use the connected dev wallet as recipient and the immutable time-lock settings.
- The live Helius subscription contract is smoke-tested, but the deployed Railway worker still needs a sustained soak. No mainnet launch/lock was run because spending requires explicit approval.
