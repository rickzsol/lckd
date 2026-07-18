# feature/trust-api — known issues at push time

Five independent review rounds. One consistency residual remains, documented here rather than fixed with a blind sixth pass, because the correct fix is a concurrency-model decision.

## Open (1)

### `backfill_complete` flag has an MVCC TOCTOU

**Where:** `set_backfill_complete_if_covered()` (trust locks migration) and `tools/backfill-locks.ts`.

**What:** The flag is written by one `INSERT ... ON CONFLICT ... SELECT` whose coverage predicate (NOT EXISTS: no eligible token lacks a verified canonical lock) evaluates against the statement's MVCC snapshot. Under PostgreSQL read-committed MVCC, a concurrent transaction that adds an eligible token or deletes a canonical lock can commit *after* that snapshot but before this transaction completes, leaving `backfill_complete = true` while coverage is actually incomplete. Collapsing the read and write into one statement removed the read-then-write gap but not the snapshot-vs-concurrent-commit gap.

**Why it is not yet fixed:** Closing an MVCC TOCTOU is a concurrency-model choice, not a one-line patch. Options:
1. Run `set_backfill_complete_if_covered()` (and any coverage-changing writes it must be consistent with) under `SERIALIZABLE` isolation with a retry loop on serialization failure. Cleanest correctness; needs the caller to handle 40001 retries.
2. Take a table/advisory lock that every coverage-changing path (canonical-lock insert/delete, eligible-token insert) also takes, so the completeness evaluation cannot interleave with them.
3. A trigger on the coverage-changing tables that invalidates/recomputes the flag, so it is derived rather than set once.

Recommendation: option 1 (`SERIALIZABLE` + retry) for the setter, since backfill completion is a rare administrative operation where a retry is cheap and the correctness guarantee is strongest. Pair with a Postgres test that interleaves a coverage-reducing write against the setter.

**Blast radius:** narrow and administrative. It only affects the one-time transition of `backfill_complete` from false to true during the staged locks backfill, which runs under operator control against a quiet dataset, not under live launch traffic. If it did fire, the trust API would treat the platform as fully backfilled slightly early; the per-token trust reads are still individually correct (each returns its own verified lock or an honest degraded/503), so the effect is a premature "backfill done" signal, not wrong per-token trust data. Applying the backfill during a maintenance window with no concurrent lock writes avoids the window entirely.

## Resolved across review (for reference)

Stream-to-lock binding (owner/mint/recipient/escrow/cliff/full-cliff schedule, including the `cliffAmount = deposited - 1` acceptance and rejection of inverted and vesting schedules), finalized-only withdrawal derivation (null account never = withdrawn), pre-cliff movement classified anomalous, monotonic `evidence_seq` compare-and-swap for tier commits (replaces wall-clock freshness; NULL inputs rejected), single tier-writer through one RPC, independent `github_tier` evidence with explicit clear, `FOR UPDATE` inbox-lease fencing in the reconciliation commit, mint-unique canonical-lock cursor for gapless keyset pagination, constant-time webhook auth with streamed byte cap and idempotent inbox, degraded/503 instead of failure-as-absence, public CORS on all paths incl. 405, definer view exposing only documented fields. All new SQL exercised on local Postgres 16; 199 tests, typecheck/lint/build green.

## Not in this branch (by design)

Production Supabase is offline: the migration is written but unapplied. Before serving: `supabase migration list` + `db push --dry-run` against the real schema, apply, run the staged `backfill-locks.ts` (maintenance window per the open issue above), then the NOT NULL follow-up. Set `HELIUS_WEBHOOK_SECRET` (256-bit) and `NEXT_PUBLIC_SITE_URL`, and register the Helius webhook via `tools/register-helius-webhook.ts` once locks exist. The SAS attestation `anchor` block in the trust response is wired by feature/sas-attestations.
