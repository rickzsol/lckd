<p align="center">
  <img src="public/og.png" alt="LCKD, the launchpad that checks receipts" width="900" />
</p>

# LCKD

Token launch workflows with explicit wallet approvals and verified on-chain receipts.

[Website](https://lckd.tech) · [Product docs](https://lckd.tech/docs) · [API reference](https://lckd.tech/api-docs) · [Risk disclosure](https://lckd.tech/risk)

LCKD is a launch interface and public receipt index. On Solana, it creates and buys a token through pump.fun, places the selected creator tokens into a Streamflow time lock, and uses the fixed 0.1 SOL launch fee to buy and burn LCKD in the same atomic transaction. An experimental Robinhood Chain path uses Pons to create a fixed-supply token and permanently transfer its Uniswap v3 LP position to the Pons locker in one transaction.

> [!CAUTION]
> This project is pre-release. Robinhood mainnet sending is disabled by default, and Robinhood launches are not yet written to public profiles. Do not use meaningful funds without reviewing the transactions, contracts, deployment configuration, and current release state yourself.

## How it works

### Solana launch

1. Sign in with GitHub and link a Solana wallet by signing an ownership message.
2. Upload token metadata and its image to IPFS through Pinata.
3. Review the quoted buy, lock amount, unlock time, and any launch fee.
4. Approve a setup transaction that creates and extends a dedicated address lookup table, then wait for it to finalize.
5. Validate and approve the issued atomic transaction. It creates the token, performs the initial buy, creates the Streamflow lock, buys LCKD with exactly 0.1 SOL, and burns the purchased LCKD together.
6. Simulate the signed transaction, submit it, and verify the finalized launch and lock receipt before recording the launch.

The setup transaction cannot create the token. The token creation, initial buy, lock, LCKD buyback, and exact burn either finalize together or do not execute. Recovery checkpoints reconcile ambiguous submissions. Fee-enabled launches deactivate and close their dedicated lookup table through the wallet-authorized cleanup path so its rent can be reclaimed.

### Robinhood Chain launch

1. Sign in with GitHub and connect an injected EVM wallet to Robinhood Chain, chain ID `4663`.
2. Verify the pinned Pons factory, locker, Uniswap contracts, launch settings, fee split, and runtime code before simulation.
3. Simulate the exact launch call. When mainnet sending is enabled, persist the launch intent and request one wallet approval.
4. Create a fixed supply of 1 billion tokens, open one-sided Uniswap v3 liquidity, and transfer the LP NFT to the Pons locker in the same transaction.
5. Wait for 20 confirmations, then verify the launch event, factory record, token state, pool, fee routing, and LP NFT owner.

Recovery checkpoints bind a launch to its GitHub session, wallet, salt, transaction value, and calldata. An ambiguous wallet result blocks another request until the existing intent is reconciled.

## Security boundaries

- Wallets remain the only transaction signers. LCKD does not custody private keys or silently send transactions.
- Launch and persistence routes require authentication, validate their origin and input, and use server-only credentials for privileged writes.
- Solana transactions are checked before signing and again against finalized chain data before persistence.
- Robinhood launches verify pinned contract code and configuration before simulation and immediately before a wallet request.
- Stored receipts and profile labels are indexes, not audits or endorsements. Verify every address, amount, authority, permission, and receipt independently.

These checks reduce transaction mismatch and receipt spoofing risk. They do not guarantee token value, liquidity, code quality, developer conduct, or third-party protocol safety.

## Stack

- Next.js 16, React 19, TypeScript, and Tailwind CSS 4
- Solana Wallet Adapter, `@solana/web3.js`, and the pump.fun SDK
- Streamflow JavaScript SDK 13
- wagmi, viem, Hardhat 3, Pons, and Uniswap v3
- Supabase Postgres, NextAuth with GitHub OAuth, and Pinata

## Local setup

Requires Node.js 24.16.0 and npm 11.13.0.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

PowerShell users can replace the copy command with `Copy-Item .env.example .env.local`. Open [http://localhost:3000](http://localhost:3000) after the development server starts.

### Environment

| Group | Variables | Purpose |
| --- | --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public reads |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only verified writes and recovery state |
| Authentication | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| Authentication | `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ALLOWED_ORIGIN` | Session signing, canonical URL, and accepted state-changing origin |
| Launch access | `PUBLIC_LAUNCHES_ENABLED`, `LAUNCH_TEST_GITHUB_IDS` | Public launch gate and preview allowlist |
| Solana RPC | `HELIUS_RPC_URL`, `NEXT_PUBLIC_HELIUS_RPC_URL`, `HELIUS_API_KEY` | Server RPC, browser RPC, and launch-monitor access |
| Launch monitor | `LAUNCH_MONITOR_URL`, `NEXT_PUBLIC_LAUNCH_MONITOR_URL` | Server and browser monitor origins |
| Launch monitor | `LAUNCH_MONITOR_ALLOWED_ORIGIN`, `LAUNCH_MONITOR_STATE_PATH` | Monitor CORS origin and persistent state path |
| Launch monitor | `OFFICIAL_LAUNCH_START_SLOT`, `OFFICIAL_TOKEN_MINT` | Official-wallet scan boundary and optional pinned mint |
| Streamflow | `NEXT_PUBLIC_STREAMFLOW_CLUSTER`, `STREAMFLOW_PROGRAM_ID` | Cluster and optional verifier override |
| Metadata | `PINATA_JWT`, `PINATA_GATEWAY` | IPFS uploads and approved public gateway |
| GitHub refresh | `GITHUB_PAT`, `CRON_SECRET` | Optional API quota and authenticated refresh job |
| Robinhood | `ROBINHOOD_RPC_URL`, `NEXT_PUBLIC_ENABLE_ROBINHOOD_LAUNCHES` | Chain reads/fork tests and the mainnet wallet-request gate |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Runtime reporting and source-map uploads |
| Launch buyback | `LAUNCH_FEE_LAMPORTS`, `BUYBACK_BURN_LOOKUP_TABLE` | Exact 0.1 SOL buyback fee and the reviewed protocol lookup table |

Never expose service-role keys, OAuth secrets, RPC credentials, Pinata credentials, or cron secrets to client code. Only variables prefixed with `NEXT_PUBLIC_` belong in the browser bundle.

## Database

Apply the Supabase migrations in order:

```text
supabase/migrations/001_initial.sql
supabase/migrations/002_backend_hardening.sql
supabase/migrations/003_distributed_rate_limits.sql
supabase/migrations/004_launch_recovery.sql
supabase/migrations/005_atomic_launch.sql
supabase/migrations/006_real_stats.sql
supabase/migrations/007_atomic_cleanup_races.sql
supabase/migrations/20260717204559_exact_atomic_issuance.sql
supabase/migrations/20260717210156_robinhood_launch_recovery.sql
supabase/migrations/20260717210158_match_applications.sql
supabase/migrations/20260717214000_fee_inclusive_atomic_lock_coverage.sql
supabase/migrations/20260718020000_burn_ledger.sql
supabase/migrations/20260718160439_buyback_completed_alt_cleanup.sql
```

The migrations create the public directory, recovery state, shared throttling, atomic issuance, launch-fee coverage, match applications, burn ledger, and completed-launch lookup cleanup. Review every migration against the target database before applying it. Do not enable Robinhood mainnet sending until `20260717210156_robinhood_launch_recovery.sql` is applied and its concurrent recovery transitions pass in a disposable environment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run lint` | Run ESLint on `src` |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run unit and integration tests |
| `npm run test:robinhood` | Run the pinned Robinhood Chain fork suite |
| `npm run e2e` | Run Chromium desktop and mobile public-route smoke tests |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |

The Robinhood fork suite uses the pinned block in `hardhat.config.ts`. Set `ROBINHOOD_RPC_URL` to a provider that can serve that historical state.

## Before deployment

- Apply and verify all database migrations.
- Configure separate server and browser credentials with the narrowest available scopes.
- Confirm the Solana RPC and Streamflow cluster match.
- Keep Robinhood mainnet sending disabled until recovery, archive RPC access, and the authenticated preview flow are verified.
- Run lint, type checks, tests, the production build, and desktop and mobile browser checks.
- Test each enabled launch path with a disposable wallet before routing public traffic.

## Risk

LCKD is transaction tooling and a public directory. It is not an exchange, custodian, auditor, broker, or investment adviser. Token creation, time locks, permanent LP locks, wallet software, RPC providers, and third-party protocols can fail or behave unexpectedly. Read the [risk disclosure](https://lckd.tech/risk) and inspect every wallet prompt before signing.
