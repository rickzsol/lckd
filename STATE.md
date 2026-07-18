# Project state

Updated: 2026-07-18

## Current status

- `main` is the stabilization baseline `e4a7e2e` plus `f1c335b`: wide-screen token page layout (full-width chart, balanced card grid, fluid contribution graph), the public `/developers` directory, and optimized token/avatar images.
- Public atomic Solana launches are live on [lckd.tech](https://lckd.tech). Production uses Node.js 24.x and the provisioned Supabase data plane; the core atomic-launch and shared-rate-limit paths are active.
- The Railway launch monitor is deployed with persistent state. Its readiness endpoint reports connected, ready, and subscribed, and the official token page and feed consume its verified state.
- The GitHub Actions billing lock is cleared and PR #9 is merged (`9b16e15`). On main pushes the quality job passes end to end (lint, typecheck, 124 tests, build, Chromium smoke), but the `robinhood-fork` job fails closed because the `ROBINHOOD_RPC_URL` repository secret is not configured, and the production deploy job is gated behind it. Until the owner sets that secret, no CI deploy reaches production. Current `main` (`590e2bc`) was deployed to production via `vercel deploy --prod --yes` (deployment `dpl_G52Up8u7P3VRtitgusSVfxP34PWC`, aliased to lckd.tech) and the wide-screen token pages and `/developers` directory were verified live at 2560px.
- The requested `trudev` snapshot is preserved on `rescue/trudev-worktree-20260718` at `bb509a3` (pushed to origin). Its token-page and directory work was re-applied onto current `main` as `f1c335b`; local `trudev/.env.local` now points at lckd-production via Supabase CLI keys.
- The exact 0.1 SOL buyback-and-burn path is deployed and configured in production, but general-release sign-off remains blocked on the first finalized fee-enabled canary and the planned Squads authority transfer. Program `7e37mm6Q8aW13jfZP27mEa1QRjue4fZ6NzNtzJyo8FZV` is deployed under temporary isolated upgrade authority `2BUx2mkRUxRg6izd2se7QWNUYRqELykKEMKFCjJ8p7Un`; its reproducible 27,472-byte executable and the mainnet dump both hash to `2d2126842fbf7ce3db71fd0494ea5c8e2803cc471c18865c3622d0bb5bfc4796`. PDA ATAs, Pump user-volume, protocol ALT `CLPNMAiLVQKjL7dTFzvaJcMtMR4BRi5hbtCXiaXUUByj`, both burn migrations, and production `BUYBACK_BURN_LOOKUP_TABLE` / `LAUNCH_FEE_LAMPORTS=100000000` are active. Vercel deployment `dpl_ChV319qEe3UMbaMDqW9Psh8nCm2p` is READY and `/burn` was verified on lckd.tech in Chrome with the connected wallet.

## Verified launch model

- A Solana launch uses two wallet approvals. The first creates and extends a dedicated address lookup table.
- The second approval signs one atomic transaction containing pump.fun token creation, the initial buy, the Streamflow lock, a fixed 0.1 SOL LCKD buyback, and an exact burn of the acquired LCKD.
- The setup transaction cannot create the token. Creation, purchase, and locking finalize together or do not execute.
- Client validation, signed-message integrity checks, simulation, finalized receipt verification, and persistence enforce the same mint, wallet, metadata, amount, fee, and lock invariants.
- Recovery checkpoints reconcile submitted transactions without issuing a conflicting launch. Buyback launches use a reviewed protocol lookup table and move per-launch lookup deactivation to the wallet-authorized cleanup path because the worst-case atomic packet is 1,201 of 1,232 bytes.
- Finalized buyback persistence records the launch and burn-ledger row in one database transaction using the chain block time. `/burn` keeps 200 recent receipts visible while lifetime totals cover the complete ledger.
- The buyback quote path fails closed if Pump rotates a compiled fee recipient or the LCKD creator-vault authority. Protocol lookup receipt verification binds to the immutable issued transaction, so environment rotation or an append-only table extension cannot invalidate a pending receipt.
- Robinhood Chain launches remain experimental and mainnet wallet requests default to disabled. Pons deployment checks, durable intent recovery, replacement discovery, and 20-confirmation receipt verification are implemented.
- Wallets remain the only transaction signers. Server credentials are limited to privileged reads, verified persistence, indexing, and recovery state.

## Quality baseline

- The main baseline passed lint, typecheck, unit/integration tests, the six-test pinned Robinhood fork suite, and the production build before stabilization began.
- Desktop and mobile production behavior has been checked manually with Playwright, including responsive navigation, overflow, console errors, and reduced motion.
- The feed and developer-directory polish pins the official launch, derives lock progress from recorded timestamps, removes the duplicate monitor panel, prioritizes visible 48px images through a faster content-addressed gateway, and adds the matched-launch offer to the home hero. Local Playwright checks at 1440px and 390px show no overflow or console warnings, and the production build plus 147 tests pass.
- The local UI audit fixes keep reveal content visible during fast scrolling, make atomic launch copy consistent, prioritize lock evidence before market links, restore a responsive GeckoTerminal market-cap chart, clarify trust and lock-progress labels, and prevent unauthenticated launch recovery requests. Token pages now expose the copyable CA and full recorded metadata, and route allowlisted token images through Next Image with WebP output and a one-day cache floor. Desktop and 390px captures have no horizontal overflow.
- The stabilization change passed the hosted Node.js 24.16.0/npm 11.13.0 quality workflow, including lint, typecheck, 124 unit/integration tests, a production build, and eight Chromium desktop/mobile smoke checks.
- The latest production dependency audit reported 8 high and 21 moderate transitive runtime findings in the Solana, Pump, and Streamflow trees. Automated forced fixes are not considered safe.
- The staged buyback and UI diff passes lint, TypeScript, 143 JavaScript tests, and the production build. Independent review corrected Token-2022 ownership/privileges, full-input Pump quoting, and donated-WSOL availability/receipt handling. Desktop and mobile launch-review captures plus `/burn` captures passed visual inspection; development CSP now supports Next.js hydration without weakening the production policy.
- The final fee-enabled mainnet-state preview simulated the complete create, initial buy, seven-day Streamflow lock, 0.1 SOL LCKD purchase, and exact burn in 399,266 CUs with a 1,006-byte v0 transaction. No launch transaction was broadcast; only temporary ALT lifecycle transactions landed.
- All deployer-owned simulation ALTs are closed and their rent is recovered. The isolated deployer balance was returned in full, minus the network fee, to wallet `8A4i2yk8R9ivCGdtQeyo71JYyB6CjfSsMnWcYthisPwT` (signature `4G2hNJ7BuHUARQTf2fS9vLS484khHJUfRWSAb9rTKc6FvdUeQK7pZKcb8RirfPQZRb9dEmbF86nVrHXCPD6WSC3h`); the deployer now has 0 SOL.

## Open release gates

- Require CI and review on `main`, protect the Production environment, and scope deployment secrets to that environment.
- Set the `ROBINHOOD_RPC_URL` repository secret (owner action; no value exists in any local env) so the fail-closed `robinhood-fork` job and the gated production deploy can run on main pushes. Verified 2026-07-18: runs 29649840661/29649986918 pass quality and fail only this job.
- Transfer the temporary program upgrade authority to the planned 2-of-3 hardware-backed Squads multisig after owner keys are defined; do not make the program immutable without a separate irreversible approval.
- Verify the first fee-enabled public launch in runtime logs, finalized receipt persistence, the combined burn-ledger row, and wallet-owned ALT cleanup; complete the pending TEST token directory verification.
- Commit the exact reviewed release source and tie the production deployment to that revision before general-release sign-off; the current Vercel promotion came from a dirty worktree containing unrelated user changes.
- Keep Robinhood mainnet sending disabled until a production-grade archive RPC is configured and the authenticated preview flow passes.
- Squash-integrate and review `feature/holder-intel`, `feature/trust-api`, and `feature/sas-attestations` from fresh current-`main` branches. Their documented concurrency findings remain release blockers.
- Track upstream dependency fixes and rerun the production audit before each release.
- Choose an explicit repository license. The public repository currently grants no explicit reuse license.
- Normalize mixed CRLF/LF endings in a dedicated mechanical change.
- Finish the Sentry-to-Discord controlled-error check and the owner-authorized Double Counter verification setup.

## Next feature wave

`TRUST_FEATURES_PLAN.md` remains the internal specification for holder intelligence, the public trust API and unlock calendar, webhook-driven lock status, and SAS trust-tier attestations. Implementation branches exist, but stabilization and independent review precede feature integration.
