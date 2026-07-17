# Project state

Updated: 2026-07-17

## Status

The repository is not approved for production launch. The hardened candidate is on `main`; production serves safe unavailable responses because its Supabase data plane is offline. No mainnet transaction or database migration was executed during this work.

## Verified behavior

- Launch uses two explicit wallet approvals: pump.fun create and buy, then Streamflow lock.
- The Streamflow v13 instruction is a cliff-based token lock. Unlockable amount is zero before the selected timestamp and the full locked amount at that timestamp.
- The lock is non-cancelable, non-transferable, cannot be topped up, cannot be paused, cannot change rate, and does not auto-withdraw.
- Browser construction, pre-sign instruction decoding, finalized chain verification, and persisted receipt checks enforce the same lock invariants.
- Retry rebroadcasts the same signed lock transaction and checks the metadata account before permitting a rebuild.
- GitHub identity, signed wallet ownership, selected wallet, launch receipt, mint configuration, and lock receipt must agree before persistence.
- Public data is shown as unavailable or unverified when its source cannot be confirmed. No production mock fallback remains.
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

- LCKD Discord was reset and hardened: fresh gated channels, private security logs, Medium verification, full media filtering, four repaired AutoMod rules, expiring invites only, and Double Counter above `Verified`. The owner-authorized Double Counter panel is still pending.
- Project-local `discord_admin` MCP is pinned to `@quadslab.io/discord-mcp@2.1.1`, scoped to guild `1519763437738135632`, and verified with an authenticated guild read.
- `npm test`: 41 passed
- `npm run test:robinhood`: 6 pinned-fork launch and idempotency tests passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed with Next.js 16.2.10
- Playwright: desktop and mobile routes, responsive menu, reduced motion, no horizontal overflow, no page console warnings
- Gitleaks: 14 commits scanned, no leaks
- Independent authentication, on-chain, deployment, recovery-state, and final patch reviews completed with no critical or high Robinhood findings
- Full mobile review of production lckd.tech (390px and 360px): all routes render without horizontal overflow or console errors; footer overlay on the coming-soon gate reproduced in production and confirmed fixed by the local SiteFooter refactor
- Mobile wallet support added: `@solana-mobile/wallet-standard-mobile@0.5.3` registers MWA for Android Chrome (chain inferred from RPC endpoint); iOS uses the existing Phantom/Solflare universal-link redirects
- Access gate now fails closed in production when `LCKD_ACCESS_CODE` is unset (the `nulllckd` fallback is dev-only); the env var must be set in Vercel before deploy
- Docs mobile section navigator no longer overshoots anchors (dropdown collapses via flushSync before scroll; headings use scroll-mt-36 on mobile)
- Live read-only Pons deployment verification and historical receipt verification passed

## Known release gates

- Authorize the Double Counter dashboard, bind `#verify`, `@Verified`, and `#verification-logs`, then publish and test its verification panel.
- Restore or provision the production Supabase project. The configured host no longer resolves; live stats/feed return `available: false` and cron cannot refresh data.
- Configure and validate `PINATA_JWT`, `HELIUS_RPC_URL`, `ALLOWED_ORIGIN`, Supabase, OAuth, and cron production values. Do not reuse credentials from another project without an explicit rotation decision.
- Review existing production rows, then apply `supabase/migrations/002_backend_hardening.sql`.
- Resolve the two-transaction guarantee: Pump creation finalizes before a separate lock approval, and launch recovery is not durable across refresh/crash.
- Replace or supplement in-memory API throttling with a distributed deployment-layer rate limit.
- Resolve the current PumpPortal unsigned create HTTP 400 and repeat live construction against the strict validator.
- Deploy this commit to a preview and verify OAuth, wallet linking, metadata upload, RPC, finalized persistence, and runtime logs.
- Apply `supabase/migrations/005_robinhood_launch_recovery.sql` to a disposable database and run concurrent prepare/ambiguous/checkpoint/replacement transition tests before production.
- Keep Robinhood mainnet sending disabled until migration 005 is applied, the authenticated preview flow passes, and a production-grade Robinhood RPC/archive provider replaces the rate-limited public endpoint.
- Verify the full authenticated Robinhood wallet flow on a preview; local dev NextAuth remained in its loading state during browser QA.
- Production dependency audit reports 8 high and 21 moderate transitive findings in the existing Solana/Pump/Streamflow dependency trees. Suggested automated fixes are unsafe downgrades or unavailable upstream fixes.
- After every gate above is green, run a disposable-wallet mainnet launch and lock. This needs explicit approval because it spends funds.
- Context7 documentation lookup is unavailable until its monthly quota resets; official primary documentation was used instead.
