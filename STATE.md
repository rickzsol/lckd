# Project state

Updated: 2026-07-17

## Status

Production release approved after independent security review and deployed at `https://lckd.tech` from commit `b125e42`. Production Supabase is migrated through `007_atomic_cleanup_races.sql`, required Vercel environment variables are configured, and the atomic launch path is live. No transaction has been signed or sent.

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

- 62 tests passed.
- TypeScript, ESLint, production build, and `git diff --check` passed.
- Independent atomic SQL, recovery, on-chain receipt, UI lifecycle, and deployment reviews passed.
- Production and staging aggregate RPC checks passed; anonymous atomic mutations are denied.
- Live production home, feed, LCKD detail, image, stats, auth gates, and security headers passed.
- Gitleaks found no committed or source/migration secrets.
- `npm audit --omit=dev`: one underlying unpatched `bigint-buffer` advisory represented by 8 dependency nodes; 0 critical and 0 moderate.

## Trust API + unlock calendar lane (branch feature/trust-api)

Built the public trust API, unlock calendar, and live lock pipeline per plan section 2 and the round-2 deltas. Not yet applied to any database (production Supabase offline); everything compiles and tests against types/mocks.

- Migration `20260718000000_trust_locks.sql`: locks + webhook_inbox (lease columns, canonical-per-token partial unique index, finalized denominator columns, status/amount check constraints), RLS enabled with no anon grants, `locks_public` definer view as the only anon-reachable lock path, `claim_webhook_inbox` lease RPC, and `tier_computed_at`/`policy_version` on tokens.
- Single trust projection (`src/lib/trust/projection.ts`) is now the only tier authority; the wall-clock downgrade in the GitHub cron and `queries.ts` display path was retired.
- Public routes: `GET /api/v1/token/:ca/trust`, `GET /api/v1/unlocks` (versioned envelope, keyset pagination, credentialless `*` CORS on every path). Webhook `POST /api/v1/webhooks/helius` (constant-time bearer before parse, streamed byte cap, durable idempotent inbox). Crons: `consume-webhooks` (leased consumer, finalized verification) and `reconcile-locks` (bounded resumable sweep).
- `/unlocks` page (date-grouped, mono countdowns, warn under 7d, unlockable danger + pulse dot, mascot empty state), navbar link, sitemap, OG image, feed next-unlock strip. Trust + unlocks sections added to `/api-docs`.
- Tools: `tools/backfill-locks.ts` (staged, nullable-first, finalized RPC denominator, NOT NULL follow-up stub) and `tools/register-helius-webhook.ts` (tracked-address batched edits, never auto-run).

Verification: 116 tests pass (62 existing + 54 new), typecheck + lint + production build clean. Internal adversarial review passed after one blocking fix (definer view). External Codex review is a remaining gate: the Windows Codex CLI has no linux binary in this WSL environment, so run the blocking Codex diff review before merge.

Open items:
- Attestation block in the trust response is shape-only (null); the SAS branch wires program id, credential PDA, schema PDA, expiry.
- Apply the migration only after `supabase migration list` + `db push --dry-run` against real production schema; then run the staged backfill, then the NOT NULL follow-up migration.
- Add `HELIUS_WEBHOOK_SECRET` (256-bit) and `NEXT_PUBLIC_SITE_URL` to production env; register the Helius webhook with the tool once locks exist.

## Remaining operational check

- Run one disposable-wallet mainnet launch only after the user supplies an explicit SOL spending cap. This is optional post-deploy validation and is the only step that spends funds.
