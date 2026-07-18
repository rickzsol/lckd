<p align="center">
  <img src="public/og.png" alt="LCKD, the launchpad that checks receipts" width="900" />
</p>

# LCKD

Token launch workflows with explicit wallet approvals and verified on-chain receipts.

[Website](https://lckd.tech) · [Product docs](https://lckd.tech/docs) · [API reference](https://lckd.tech/api-docs) · [Risk disclosure](https://lckd.tech/risk)

LCKD is a launch interface and public receipt index. On Solana, it creates and buys a token through pump.fun, then places selected creator tokens into a separate Streamflow time lock. An experimental Robinhood Chain path uses Pons to create a fixed-supply token and permanently transfer its Uniswap v3 LP position to the Pons locker in one transaction.

> [!CAUTION]
> This project is pre-release. Robinhood mainnet sending is disabled by default, and Robinhood launches are not yet written to public profiles. Do not use meaningful funds without reviewing the transactions, contracts, deployment configuration, and current release state yourself.

## How it works

### Solana launch

1. Sign in with GitHub and link a Solana wallet by signing an ownership message.
2. Upload token metadata and its image to IPFS through Pinata.
3. Build and validate a pump.fun create-and-buy transaction, then approve it in the linked wallet.
4. Wait for confirmation and read the purchased token balance from the connected wallet.
5. Build and validate a Streamflow lock for the selected amount and unlock time, then approve it separately.
6. Verify the finalized create and lock receipts before recording the launch.

Creation and locking are separate transactions. Creation can finalize while the lock is rejected, expires, or fails. LCKD preserves the partial launch state and offers a lock retry, but the purchased tokens remain liquid until a valid lock confirms.

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

Requires Node.js 20.9 or newer and npm 11.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

PowerShell users can replace the copy command with `Copy-Item .env.example .env.local`. Open [http://localhost:3000](http://localhost:3000) after the development server starts.

### Environment

| Variables | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase reads |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only verified writes and recovery state |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Session signing and canonical application URL |
| `ALLOWED_ORIGIN` | HTTPS origin accepted by state-changing routes |
| `HELIUS_RPC_URL`, `NEXT_PUBLIC_HELIUS_RPC_URL` | Server and browser Solana RPC endpoints |
| `NEXT_PUBLIC_STREAMFLOW_CLUSTER`, `STREAMFLOW_PROGRAM_ID` | Streamflow cluster and optional verifier override |
| `PINATA_JWT`, `PINATA_GATEWAY` | IPFS metadata uploads and public gateway |
| `GITHUB_PAT`, `CRON_SECRET` | Optional GitHub API quota and authenticated refresh job |
| `ROBINHOOD_RPC_URL` | Robinhood Chain reads, recovery scans, and fork tests |
| `NEXT_PUBLIC_ENABLE_ROBINHOOD_LAUNCHES` | Enables Robinhood mainnet wallet requests when set to `true`; defaults to simulation only |

Never expose service-role keys, OAuth secrets, RPC credentials, Pinata credentials, or cron secrets to client code. Only variables prefixed with `NEXT_PUBLIC_` belong in the browser bundle.

## Database

Apply the Supabase migrations in order:

```text
supabase/migrations/001_initial.sql
supabase/migrations/002_backend_hardening.sql
supabase/migrations/003_distributed_rate_limits.sql
supabase/migrations/004_launch_recovery.sql
supabase/migrations/005_robinhood_launch_recovery.sql
```

The migrations create the public token and profile tables, harden row-level access, add distributed API throttling, and persist recovery state for both launch paths. Review every migration against the target database before applying it. Do not enable Robinhood mainnet sending until migration `005` is applied and tested in a disposable environment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run lint` | Run ESLint on `src` |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run unit and integration tests |
| `npm run test:robinhood` | Run the pinned Robinhood Chain fork suite |
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
