# Project state

Updated: 2026-07-20

## Current status

- Remote `main` is `caa8b94`, the merge commit for PR #13's truthful public-data release. The older local `main` worktree has diverged and is not the release source.
- Public atomic Solana launches are live on [lckd.tech](https://lckd.tech). Production uses Node.js 24.x and the provisioned Supabase data plane; the core atomic-launch and shared-rate-limit paths are active.
- The Railway launch monitor is deployed with persistent state. Its readiness endpoint reports connected, ready, and subscribed, and the official token page and feed consume its verified state.
- Main workflow run `29747944873` passed quality, the Robinhood fork, and production deployment for `caa8b94`. Vercel deployment `9mkhW3kd7wHvbeu5c6AH9Xj6e2tQ` is aliased to lckd.tech.
- The truthful public-data release is live: `/stats` uses only the vetted database RPC, unavailable homepage counters render as unknown, confirmed-only allocation classifications render as provisional signals, and historical lock records do not claim a current balance. It passed lint, typecheck, 184 tests, production build, independent review, and eight desktop/mobile Chromium route checks before merge.
- The requested `trudev` snapshot is preserved on `rescue/trudev-worktree-20260718` at `bb509a3` (pushed to origin). Its token-page and directory work was re-applied onto current `main` as `f1c335b`; local `trudev/.env.local` now points at lckd-production via Supabase CLI keys.
- The exact 0.1 SOL buyback-and-burn path is live and canary-verified. Program `7e37mm6Q8aW13jfZP27mEa1QRjue4fZ6NzNtzJyo8FZV` has a reproducible 27,472-byte executable whose local artifact and mainnet dump both hash to `2d2126842fbf7ce3db71fd0494ea5c8e2803cc471c18865c3622d0bb5bfc4796`. Upgrade authority is Squads vault `9S8mjC1NFLejZpwJjtUJ8mjuy7BtykZNTvDWM2g42QJH`, derived from multisig `7LPtyk1WxCqx2BXcYgzoPSyk44J4dkfUU6r75CZJehUV` with threshold 2, three members, time lock 0, and disabled config authority; transfer signature `4SQmomuK4RLn39RX3Gq2ku9CCjvQ1wVVhVtrBYeQ4WNU7GZiWqx7XrwMQpoSbKD5Ja8xmGo6yQ1BWUJPu2LTK9nb` is finalized. PDA ATAs, Pump user-volume, protocol ALT `CLPNMAiLVQKjL7dTFzvaJcMtMR4BRi5hbtCXiaXUUByj`, both burn migrations, `BUYBACK_BURN_LOOKUP_TABLE`, and `LAUNCH_FEE_LAMPORTS=100000000` are active.
- The fee-enabled mainnet canary created mint `BzKWchAQ1CgG52scBs1B5DnmLdYWhWUAhrQFYug893mP` in finalized transaction `4HQ4DSCTBuh8pKKTW8gSfsdRZHLoxAwNbtNB4JXtEkABfdK2Phos7KHXq6eTv9T8e9ow7DqhVkm3VGqz1Szg3Dy4`. Production receipt recovery is `completed`; `/api/v1/burn` records exactly 0.1 SOL and 250,761.604456 LCKD bought and burned, with current supply 999,748,457.145755. The failed-attempt ALT `CX3Zb6eaiWaQvvhJiBK8sniaho2jPhUvDDY6fNSwY8Tu` is closed. The successful ALT `77G3qNXtJAYYokEqqtbyh8dhQdpVFEJedJdNStbiNi9Q` is deactivated and awaits a final owner-wallet close after Phantom was switched away from its authority account.
- Release commits `31f8f984a6b0294193b225d939d411d5091c41d6`, `e7d80a94b55f926f0ab7d07734404ff7d5937a00`, `be74998bef8da38c5fc4c509d1a146e3895951a8`, and `/burn` proof commit `abbd3293cdcbad18111ea4d1fb922006fae4f3ae` are on `main`. Exact clean Vercel deployment `dpl_2vUeXBDznr3UtUbLzqh6YFgh4C9o` is READY and promoted to production; its Sentry release and deployment metadata both resolve to `abbd3293cdcbad18111ea4d1fb922006fae4f3ae`.
- Phantom's cleanup warning was traced to its transaction-simulation review, not a public domain blocklist or a recipient mismatch. Lookup setup, atomic launch, and cleanup now run a bounded unsigned `sigVerify:false` simulation before Phantom; multi-signer stages collect the wallet signature before mint and metadata signatures, then retain message-integrity validation and a fully signed simulation. The remediation passes lint, typecheck, 148 tests, production build, and independent security review.

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
- The live canary passed strict finalized receipt reconciliation, independent pool-delta and zero-residual-PDA checks, and the public burn-ledger aggregate. The current release passes lint, typecheck, 146 tests, and a production build. Production `/burn` passed Chrome inspection plus Playwright screenshots at 1440x1000 and 390x844 with no horizontal overflow or console errors.
- The truthfulness release preserves the existing industrial UI while replacing unavailable hero counters with `--`, relabeling provisional allocation totals as signals, and marking recent movements provisional. Production `/api/v1/stats` returned an available timestamped aggregate with 8 launches, 61,960,602.353952 locked tokens, and 3 verified developers. The allocation-bearing LCKD token page rendered the provisional labels and unknown current lock balance at desktop and 360px mobile with zero horizontal overflow. GeckoTerminal's embedded frame produced its own image and service-worker 403 errors; no LCKD-origin request failed.

## Open release gates

- Add persisted allocation finality, confidence, and evidence plus the finalized reconciliation sweep before presenting any movement classification as settled fact.
- Require CI and review on `main`, protect the Production environment, and scope deployment secrets to that environment.
- Close the deactivated canary ALT `77G3qNXtJAYYokEqqtbyh8dhQdpVFEJedJdNStbiNi9Q` from its owner wallet `8A4i2yk8R9ivCGdtQeyo71JYyB6CjfSsMnWcYthisPwT`; Phantom is currently switched to another account. Complete the pending TEST token directory verification.
- Submit Phantom's dApp review form with the prior successful owner-recipient ALT close if its warning remains after the signing and pre-simulation remediation is deployed.
- Keep Robinhood mainnet sending disabled until a production-grade archive RPC is configured and the authenticated preview flow passes.
- Squash-integrate and review `feature/holder-intel`, `feature/trust-api`, and `feature/sas-attestations` from fresh current-`main` branches. Their documented concurrency findings remain release blockers.
- Track upstream dependency fixes and rerun the production audit before each release.
- Choose an explicit repository license. The public repository currently grants no explicit reuse license.
- Normalize mixed CRLF/LF endings in a dedicated mechanical change.
- Finish the Sentry-to-Discord controlled-error check and the owner-authorized Double Counter verification setup.

## Next feature wave

`TRUST_FEATURES_PLAN.md` remains the internal specification for holder intelligence, the public trust API and unlock calendar, webhook-driven lock status, and SAS trust-tier attestations. Implementation branches exist, but stabilization and independent review precede feature integration.
