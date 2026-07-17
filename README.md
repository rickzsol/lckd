# LCKD

LCKD is a Solana launch interface that constructs a pump.fun create-and-buy transaction with the official Pump SDK, then places the creator's purchased tokens into a separate, time-based Streamflow lock. GitHub identity, wallet ownership, launch receipts, and lock receipts are verified before a token is recorded.

## Transaction flow

1. Sign in with GitHub and link a Solana wallet by signing the displayed ownership message.
2. Upload token metadata to IPFS through Pinata.
3. Review and sign the pump.fun creation transaction.
4. Wait for the creation transaction and purchased token balance to confirm.
5. Review and sign the Streamflow lock transaction.
6. Confirm the Streamflow account is a non-cancelable time lock for the selected amount and unlock timestamp.
7. Record the finalized launch and lock receipts.

Creation and locking are separate transactions. A creation can succeed while locking or persistence fails. The launch screen preserves this partial state and provides a lock retry path without recreating the token.

## Stack

- Next.js 16, React 19, TypeScript, and Tailwind CSS 4
- Solana Wallet Adapter and `@solana/web3.js`
- Streamflow JavaScript SDK 13
- Supabase Postgres
- NextAuth 4 with GitHub OAuth
- Pinata for public IPFS metadata

## Local setup

Requirements: Node.js 20.9 or newer and npm 11.

```bash
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Configure these values in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL used for public reads |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key used for public reads |
| `SUPABASE_URL` | Server-only Supabase project URL; may match the public URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for verified writes |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth application |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Session signing secret and canonical application URL |
| `HELIUS_RPC_URL` | Server-only Solana RPC used to verify finalized receipts |
| `NEXT_PUBLIC_HELIUS_RPC_URL` | Browser Solana RPC used for wallet transactions |
| `NEXT_PUBLIC_STREAMFLOW_CLUSTER` | `mainnet`, `devnet`, `testnet`, or `local`; must match the RPC |
| `STREAMFLOW_PROGRAM_ID` | Optional server verifier override for the selected cluster |
| `PINATA_JWT` / `PINATA_GATEWAY` | Pinata upload credential and public gateway host |
| `GITHUB_PAT` | Optional token for higher GitHub API limits and refresh jobs |
| `CRON_SECRET` | Bearer secret for the GitHub refresh cron route |
| `ALLOWED_ORIGIN` | Canonical HTTPS origin accepted by state-changing API routes |

Never expose the service-role key, Pinata JWT, GitHub secret, cron secret, or server RPC credential to client code.

## Database

Apply migrations in order before starting the production application:

```text
supabase/migrations/001_initial.sql
supabase/migrations/002_backend_hardening.sql
```

The second migration adds receipt verification fields, wallet ownership constraints, transaction uniqueness, and server-only mutation policies. Review it against the target database before applying it.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run start
```

## Production checks

- Set every required environment variable in the deployment target.
- Confirm the RPC and Streamflow cluster match.
- Apply both database migrations before routing traffic to the new build.
- Restrict Supabase, Helius, GitHub, and Pinata credentials to the intended origins and scopes.
- Verify GitHub OAuth callback URLs and `NEXTAUTH_URL` use the production origin.
- Run lint, type checks, lock invariant tests, the production build, and desktop/mobile browser checks.
- Test a real launch and lock on the intended cluster with a disposable wallet before enabling public use.

No transaction is sent without explicit wallet approval. LCKD records on-chain evidence, but it does not guarantee token value, code quality, liquidity, or developer conduct.
