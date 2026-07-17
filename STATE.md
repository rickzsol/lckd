# Project state

Updated: 2026-07-17

## Status

The deterministic launch issuance fix is complete and verified locally. Staging Supabase is migrated through `20260717204559_exact_atomic_issuance.sql`; production Supabase and the production app have not received this release yet. No transaction has been signed or sent by the agent.

Setup and atomic retries now return exact persisted unsigned transactions, including the original ALT recent slot, blockhash tuple, frozen quote, lock amount, Streamflow fee, and unlock time. Wallet signing must preserve message bytes; local mint/metadata signatures are restored without changing the wallet signature. Recovered IPFS metadata and its image survive cleanup, stale image drafts are rejected, and failed atomic receipts can enter guarded cleanup.

On 2026-07-17, a dirty CLI deployment from `a142b1f` temporarily replaced production, removed the atomic route, and failed every Pump V2 launch because its non-ALT message exceeded Solana's transaction size limit. The reviewed atomic deployment was restored and its route, client bundle, and production alias were verified.

## Launch invariants

- Approval one creates and extends one exact address lookup table.
- Approval two atomically creates the Pump token, executes the reviewed exact-token buy, deposits the selected amount into an immutable Streamflow v13 cliff lock, and deactivates the lookup table.
- The wallet, mint, and Streamflow metadata keypairs are the only signers; private keys remain in browser memory.
- Finalized receipts, exact messages, blockhashes, signer vectors, accounts, instruction data, quote/spend bounds, lock amount, and unlock time are verified before recording.
- Confirmed or finalized uncheckpointed transactions are reconciled before cleanup; still-processing transactions block cleanup.
- Lookup-table close is wallet-authorized after SlotHashes cooldown and returns rent to the wallet.

## Production infrastructure

- Supabase production: `lzxdqxtsceizopjqqxdb`, migrations 001-007 applied, schema lint clean, performance advisor clean.
- Supabase staging: `tmkrxqjaoarmjyyjlxqk`, migrations 001-007 applied and lint clean.
- Vercel production env includes Supabase, Helius, Pinata, GitHub OAuth, NextAuth, `ALLOWED_ORIGIN`, and mainnet Streamflow configuration.
- Public landing statistics use aggregate database data; production currently reports zero launches, locked tokens, verified developers, and active builders.
- LCKD is listed separately as a manual token announcement with the user-supplied `pfp-3c.png`; its CA remains unset until launch.

## Verification

- 69 tests passed.
- TypeScript, ESLint, production build, and `git diff --check` passed.
- Independent atomic SQL, recovery, on-chain receipt, UI lifecycle, and deployment reviews passed.
- Staging migration, schema lint, service-role access, and anonymous denial checks passed.
- Live production home, feed, LCKD detail, image, stats, auth gates, and security headers passed.
- Gitleaks found no committed or source/migration secrets.
- `npm audit --omit=dev`: one underlying unpatched `bigint-buffer` advisory represented by 8 dependency nodes; 0 critical and 0 moderate.

## Remaining release gates

- Reconcile the clean atomic launch branch with the uncommitted production monitor candidate without removing `/token/lckd`.
- Apply the exact issuance migration to production immediately before the coordinated app deployment.
- Run one disposable-wallet mainnet launch only after the user supplies an explicit SOL spending cap.
