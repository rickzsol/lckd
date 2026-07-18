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

Verification: 199 tests pass. typecheck + lint + production build clean. The
migration + new/changed SQL functions were also applied and exercised against an
ephemeral Postgres 16 (Docker) to prove the plpgsql behavior directly.

Round-5 (final surgical) closed four residuals from round-4 on this branch:
- 5 (residual): a wall-clock tier_computed_at is not a valid freshness token — a
  snapshot projected from OLD evidence but WRITTEN later carries a newer timestamp
  and won the comparison, overwriting fresher evidence. Freshness is now a
  compare-and-swap on a monotonic tokens.evidence_seq that commit_token_tier owns:
  callers pass the revision they read (p_prev_evidence_seq), the write applies only
  when it still equals the stored revision, and evidence_seq bumps to stored+1 only
  on a real apply. A stale snapshot loses regardless of wall-clock. Verified in
  Postgres: prev=stale + timestamp +1h => no-op; fresh prev => applies, seq bumps.
- Round-4 new defect: a NULL p_tier_computed_at made the freshness comparison NULL
  and bypassed the guard (could clear the stored stamp). commit_token_tier now
  RAISES on NULL p_tier_computed_at and NULL p_prev_evidence_seq. Verified both
  raise in Postgres.
- 10 (residual): backfill_coverage_complete() and the trust_kv write were separate
  transactions (TOCTOU — coverage could drift between check and set). New
  set_backfill_complete_if_covered() evaluates the NOT EXISTS predicate INSIDE the
  same INSERT ... ON CONFLICT that writes backfill_complete, so the flag can never
  be set from a stale coverage read. backfill-locks.ts calls it instead of the
  two-round-trip read+upsert. Verified: coverage flips drive the flag in one call.
- Schedule residual: the dropped period/rate check was restored in bindStreamToLock
  and the backfill validator — period === 1 and amountPerPeriod === 1 (the SDK's
  buildLockParams full-cliff residual), rejecting arbitrary vesting schedules that
  otherwise satisfy the gap and cliff-amount checks.
Tests added: stale-snapshot-loses + null-rejection CAS mirror (tierCommitPolicy),
reconcile threads the evidence revision for the CAS (reconcileLock), full-cliff
rejection of a vesting schedule (bind + backfill).

Round-4 (final) review resolved the remaining round-3 partials plus three new
defects it introduced. All on this branch:
- 3 (final): backfill now makes recipient AND escrow comparison MANDATORY (a
  missing provenance field or any mismatch fails the row, no longer optional),
  compares the decoded cliff timestamp against the stored unlock provenance, and
  asserts the full-cliff SCHEDULE (start==cliff, end>=cliff, no post-cliff tail)
  so nothing is unlockable before the cliff.
- 5 (final): commit_token_tier is now atomic + monotonic — it SELECT ... FOR
  UPDATE locks the token row and gates the write on tier_computed_at being
  strictly newer than stored, so a racing older recompute is a no-op instead of
  last-writer-wins.
- 8 (final): commit_lock_reconciliation SELECT ... FOR UPDATE locks the inbox row
  and re-checks lease_id + processed_at IS NULL in the SAME transaction as the
  lock/token write, closing the TOCTOU window.
- 10 (final): backfill completeness is a single NOT EXISTS query
  (backfill_coverage_complete: zero eligible tokens lacking a verified canonical
  lock), replacing the racing expected==done count arithmetic. isBackfillComplete
  arithmetic helper removed.
- NEW: bindStreamToLock rejected inverted schedules because end < cliff made
  (end - cliff) negative and slipped past the <=1s tail bound. Restored an
  explicit end >= cliff guard in bind and backfill.
- NEW: github_tier was coalesced (null could never clear obsolete GitHub
  evidence). Added p_set_github_tier boolean; the GitHub refresh passes true and
  writes exactly what it computed (including a cleared null), reconciliation
  passes false.
- NEW: (cliff_ts, mint) was not a provably-unique order. Added
  locks_canonical_mint_unique partial unique index so mint is unique per
  canonical lock and pagination cannot skip/duplicate on duplicate cliff_ts.
Tests added: monotonic tier gate, NOT EXISTS coverage (tierCommitPolicy),
inverted-schedule rejection (bind + backfill), github-clear param, cursor
total-order pagination.

Round-3 confirmation review (BLOCKED) found several round-2 fixes did not fully
land plus one new defect; all addressed across 4 more commits on this branch:
- 2 (reopened): a null finalized account was still treated as a confirmed
  closure -> withdrawn. Now the read reads the ACTUAL account owner first; a null
  account is `not_found` (throws StreamUnavailableError), never withdrawn.
  Withdrawal comes only from an existing stream whose withdrawnAmount reached the
  deposit (or its decoded closed flag) at/after the cliff.
- 3 (reopened): reconcile + backfill now read the account's real owner via
  getAccountInfo and require it to equal the pinned Streamflow program; backfill
  also compares recipient + escrow against the stored launch-intent provenance.
- 3 (NEW defect): strict cliffAmount === deposited rejected valid SDK full-cliff
  locks. Now accept cliffAmount within [deposited-1, deposited] (the SDK's
  isCliffCloseToDepositedAmount), in bind, creation-verify, and backfill.
- 5 (reopened): only the canonical lock projects the token tier (noncanonical
  passes token_id NULL and cannot move trust_tier); github_tier is written only as
  independent evidence; all trust_tier writes route through the single
  commit_token_tier function, so refresh-github is no longer a second writer.
- 6 (reopened): sweep orders by last_attempt_at (nulls first) and stamps an
  attempt on EVERY try including failures (mark_lock_attempt), and tracks
  processed ids within a run, so persistently-failing rows rotate out of page 1.
- 8 (reopened): commit_lock_reconciliation now takes the inbox id + lease id and
  gates the whole commit on the lease still being held and processed_at IS NULL.
- 10 (reopened): backfill_complete now requires expected eligible tokens ==
  verified canonical locks (a skipped token can no longer mark it done); the trust
  route returns 503 while backfill is incomplete instead of lock:null.
- 11 (reopened): a canonical lock with last_verified_at null is treated as
  unverified -> stale, never fresh.
- 12 (reopened): locks_public drops id and token_id (callers key off mint; token
  display fields folded into the view); the keyset cursor is (cliff_ts, mint).

Original round-3 items already resolved and not regressed:
- 1 (critical): claim/complete/fail/commit RPCs revoked from PUBLIC/anon/auth,
  granted only to service_role.
- 2: readFinalizedStreamState returns a discriminated outcome; a confirmed
  closure is distinguished from RPC/lookup failure; absence never = withdrawn.
- 3: decoded stream is bound to the stored lock identity + cliff-only schedule
  before it is trusted (reconcile + backfill).
- 4: pre-cliff movement classified anomalous; the withdrawn<=deposited constraint
  is conditional so anomalous observations persist.
- 5: single tier authority: project from the canonical lock + persisted
  github_tier evidence, commit lock+token atomically via commit_lock_reconciliation.
- 7: inbox dedup on (provider, signature, event_type); malformed nonempty batches
  rejected; entries with no usable account keys dropped, not persisted.
- 9: raw amounts are decimal strings end to end (view casts to text); ratios use
  BigInt.
- 13: explicit 405 handlers with public CORS on the two public routes.
- 14: register-helius-webhook fails instead of silently truncating addresses.

Open items:
- Attestation block in the trust response is shape-only (null); the SAS branch wires program id, credential PDA, schema PDA, expiry.
- Apply the migration only after `supabase migration list` + `db push --dry-run` against real production schema; then run the staged backfill, then the NOT NULL follow-up migration.
- Add `HELIUS_WEBHOOK_SECRET` (256-bit) and `NEXT_PUBLIC_SITE_URL` to production env; register the Helius webhook with the tool once locks exist.

## Remaining operational check

- Run one disposable-wallet mainnet launch only after the user supplies an explicit SOL spending cap. This is optional post-deploy validation and is the only step that spends funds.
