-- Trust locks + webhook inbox for the public trust API and unlock calendar.
-- Full-timestamp version prefix per the migration-versioning hazard: strictly
-- greater than every deployed numeric migration, never renumbered. Verify with
-- `supabase migration list` + `db push --dry-run` before any apply.
--
-- Posture mirrors migration 002: RLS enabled, no anon/authenticated grants on
-- base tables, public reads flow through explicit safe views on the anon client.
-- Server routes use the service-role client (getServerClient) which bypasses RLS.

begin;

-- ---------------------------------------------------------------------------
-- Trust projection storage on tokens. Tier is a single projection derived from
-- lock evidence + GitHub evidence; retire the scattered wall-clock downgrade in
-- favour of these persisted fields. Nullable so existing rows are unaffected
-- until the projection first writes them.
-- ---------------------------------------------------------------------------
alter table public.tokens
  add column if not exists tier_computed_at timestamptz,
  add column if not exists policy_version int,
  -- Independent GitHub-evidence tier, persisted separately from the projected
  -- trust_tier. The projection floors trust_tier to LOCKED for an expired lock;
  -- if we re-read trust_tier as GitHub evidence we would permanently lose the
  -- original GitHub tier (finding 5). github_tier is the durable GitHub input.
  add column if not exists github_tier int;

-- ---------------------------------------------------------------------------
-- locks: canonical on-chain lock evidence per token.
-- Finalized supply/decimals/lock_bps are captured at verification so pctOfSupply
-- derives from mint supply, never from tokens.lock_percentage (deposited basis).
-- Backfilled by tools/backfill-locks.ts as nullable-first, then a follow-up
-- migration enforces NOT NULL once verified. See that script's header.
-- ---------------------------------------------------------------------------
create table if not exists public.locks (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id),
  cluster text not null,
  mint text not null,
  stream_program text not null,           -- pinned Streamflow program id
  stream_id text not null,                -- stream/metadata account pubkey
  escrow_ata text not null,               -- derived escrow token account
  recipient text not null,
  deposited_amount numeric not null,
  cliff_ts timestamptz not null,          -- canonical; raw chain seconds in cliff_ts_raw
  cliff_ts_raw bigint not null,
  withdrawn_amount numeric not null default 0,
  -- Finalized denominator inputs. Nullable during backfill, enforced later.
  total_supply_raw bigint,
  decimals int,
  lock_bps int,
  status text not null default 'locked',  -- locked | unlock_eligible | withdrawn | anomalous
  canonical boolean not null default true,
  creation_signature text not null,
  creation_slot bigint not null,
  last_verified_signature text,
  last_verified_slot bigint,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint locks_status_check
    check (status in ('locked', 'unlock_eligible', 'withdrawn', 'anomalous')),
  constraint locks_deposited_nonneg check (deposited_amount >= 0),
  constraint locks_withdrawn_nonneg check (withdrawn_amount >= 0),
  -- Only non-anomalous rows must satisfy withdrawn <= deposited. An anomalous
  -- observation (withdrawn exceeding deposited, or dropping below stored) must be
  -- persisted verbatim as evidence, not rejected by the constraint (finding 4).
  constraint locks_withdrawn_le_deposited
    check (status = 'anomalous' or withdrawn_amount <= deposited_amount),
  constraint locks_cliff_raw_nonneg check (cliff_ts_raw >= 0),
  constraint locks_supply_nonneg check (total_supply_raw is null or total_supply_raw >= 0),
  constraint locks_decimals_range check (decimals is null or (decimals >= 0 and decimals <= 18)),
  constraint locks_bps_range check (lock_bps is null or (lock_bps >= 0 and lock_bps <= 10000))
);

-- One on-chain lock is unique by its stream account within a cluster/program.
create unique index if not exists locks_stream_unique
  on public.locks (cluster, stream_program, stream_id);

-- One canonical lock per token. Extras are aggregated explicitly by the reader.
create unique index if not exists locks_canonical_per_token
  on public.locks (token_id)
  where canonical;

-- Calendar/keyset index. Ordering column set matches the (cliff_ts, mint)
-- pagination cursor; only rows still visible in the calendar are indexed. mint is
-- unique per token and the calendar reads only canonical locks, so no internal id
-- tiebreaker is needed and the public view exposes none (finding 12).
create index if not exists locks_cliff_idx
  on public.locks (cliff_ts, mint)
  where status in ('locked', 'unlock_eligible');

-- ---------------------------------------------------------------------------
-- trust_kv: tiny durable key/value for cron sweep state and backfill gating.
--   reconcile_cursor      -> persisted keyset cursor so the daily sweep resumes
--                            where it stopped instead of re-scanning the first
--                            page every run (finding 6).
--   backfill_complete     -> 'true' once tools/backfill-locks.ts records a full
--                            pass with every canonical lock denominator filled.
--                            The public view returns rows only after this flips,
--                            so partially-backfilled locks are never exposed
--                            (finding 10).
-- RLS enabled, no anon grants; server (service_role) reads/writes only.
-- ---------------------------------------------------------------------------
create table if not exists public.trust_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.trust_kv (key, value)
values ('backfill_complete', 'false')
on conflict (key) do nothing;

alter table public.trust_kv enable row level security;
revoke all on public.trust_kv from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- webhook_inbox: durable idempotent landing zone for Helius deliveries.
-- Lease columns drive the cron consumer: claim with locked_until, back off via
-- next_retry_at/attempts, dead-letter after N attempts.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  signature text not null,
  event_type text not null,
  slot bigint,
  payload_hash text not null,
  payload jsonb not null,                 -- bounded, normalized subset only
  attempts int not null default 0,
  -- Random fencing token stamped by claim_webhook_inbox. Every completion,
  -- failure, and reconciliation commit is conditioned on this so a stale worker
  -- whose lease expired cannot overwrite a newer worker's result (finding 8).
  lease_id uuid,
  locked_until timestamptz,
  next_retry_at timestamptz,
  processed_at timestamptz,
  dead_lettered boolean not null default false,
  received_at timestamptz not null default now(),
  constraint webhook_inbox_attempts_nonneg check (attempts >= 0),
  -- Dedup by (provider, signature, event_type): stable across Helius retries.
  -- event_index (batch position) is NOT stable because Helius can regroup or
  -- reorder retried deliveries, so it must never be part of the identity
  -- (finding 7). One enhanced transaction is one (signature, type) subevent.
  unique (provider, signature, event_type)
);

-- Consumer claim scan: unprocessed, not dead-lettered, past its retry gate.
create index if not exists webhook_inbox_claimable_idx
  on public.webhook_inbox (next_retry_at, received_at)
  where processed_at is null and dead_lettered = false;

-- Retention prune target: processed rows aged out by the cleanup job.
create index if not exists webhook_inbox_processed_idx
  on public.webhook_inbox (processed_at)
  where processed_at is not null;

-- ---------------------------------------------------------------------------
-- RLS: enabled, no anon/authenticated grants. Public reads via safe views only.
-- ---------------------------------------------------------------------------
alter table public.locks enable row level security;
revoke all on public.locks from public, anon, authenticated;

alter table public.webhook_inbox enable row level security;
revoke all on public.webhook_inbox from public, anon, authenticated;

-- Safe public view: only lock rows whose token is publicly visible (matches the
-- tokens_select policy: launch + lock verified). Exposes ONLY the documented
-- fields the trust API and unlock calendar consume. The internal surrogate keys
-- `id` and `token_id` are NOT exposed (finding 12): callers key off the public
-- `mint` instead. `recipient`, escrow, signatures, and slots stay omitted too.
-- The token display fields (name/ticker/image_uri/trust_tier) are joined in so
-- the calendar needs no separate embed through an internal id.
--
-- Gated on trust_kv.backfill_complete = 'true': until the staged backfill records
-- a complete pass, the view returns nothing, so partially-backfilled locks with
-- null denominators are never exposed as public trust data (finding 10).
--
-- Intentionally a SECURITY DEFINER view (the default; no security_invoker): the
-- view is owned by the migration role, which reads the RLS-locked `locks` table
-- on the caller's behalf. The anon client has no grant or policy on `locks`
-- itself, so this view is the ONLY path anon can reach lock rows, and it is
-- pre-filtered to publicly visible tokens. An invoker view here would return
-- zero rows because anon has neither a grant nor a select policy on `locks`.
create or replace view public.locks_public as
select
  l.mint,
  l.stream_program,
  l.stream_id,
  -- Raw u64/u128 token amounts as decimal strings. numeric/bigint exceed the
  -- safe JS integer range, so cast to text at the view boundary and keep them
  -- strings end to end; ratio math is done with BigInt, never Number (finding 9).
  l.deposited_amount::text as deposited_amount,
  l.withdrawn_amount::text as withdrawn_amount,
  l.total_supply_raw::text as total_supply_raw,
  l.decimals,
  l.lock_bps,
  l.cliff_ts,
  l.status,
  l.canonical,
  l.last_verified_at,
  -- Documented token display fields, already anon-visible via tokens_select, so
  -- the calendar reads them here instead of embedding through an internal id.
  t.name as token_name,
  t.ticker as token_ticker,
  t.image_uri as token_image_uri,
  t.trust_tier as token_trust_tier
from public.locks l
join public.tokens t on t.id = l.token_id
where t.launch_verified_at is not null
  and t.lock_verified_at is not null
  and exists (
    select 1 from public.trust_kv k
    where k.key = 'backfill_complete' and k.value = 'true'
  );

grant select on public.locks_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_backfill_complete: anon-callable gate read. trust_kv is RLS-locked with no
-- anon grant, but the public trust route must distinguish "backfill incomplete"
-- (withhold with 503) from "no lock" (finding 10). This definer function exposes
-- ONLY the single boolean, never the table, so anon can branch without a grant on
-- trust_kv itself.
-- ---------------------------------------------------------------------------
create or replace function public.is_backfill_complete()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select value = 'true' from public.trust_kv where key = 'backfill_complete'),
    false
  );
$$;

revoke all on function public.is_backfill_complete() from public;
grant execute on function public.is_backfill_complete() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_webhook_inbox: atomically lease a batch of claimable rows for the cron
-- consumer. SKIP LOCKED prevents two runs from grabbing the same row; the lease
-- (locked_until) makes a crashed run's rows reclaimable after it expires.
-- ---------------------------------------------------------------------------
create or replace function public.claim_webhook_inbox(
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.webhook_inbox
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  now_ts timestamptz := clock_timestamp();
  lease uuid := gen_random_uuid();
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid claim limit' using errcode = '22023';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'Invalid lease window' using errcode = '22023';
  end if;

  -- One fencing token per claim batch. Completion/failure updates below must
  -- carry it back so an expired-lease worker cannot clobber a fresher lease.
  return query
  with claimable as (
    select id
    from public.webhook_inbox
    where processed_at is null
      and dead_lettered = false
      and (locked_until is null or locked_until < now_ts)
      and (next_retry_at is null or next_retry_at <= now_ts)
    order by received_at
    limit p_limit
    for update skip locked
  )
  update public.webhook_inbox w
  set locked_until = now_ts + make_interval(secs => p_lease_seconds),
      lease_id = lease,
      attempts = w.attempts + 1
  from claimable c
  where w.id = c.id
  returning w.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_inbox_row / fail_inbox_row: fenced lease completions. Every write is
-- conditioned on the caller's lease_id AND processed_at IS NULL, so a worker
-- whose lease expired (and was reclaimed by another run) cannot overwrite the
-- new owner's result (finding 8). Returns the number of rows actually updated.
-- ---------------------------------------------------------------------------
create or replace function public.complete_inbox_row(
  p_id uuid,
  p_lease_id uuid,
  p_processed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated integer;
begin
  update public.webhook_inbox
  set processed_at = p_processed_at, locked_until = null
  where id = p_id
    and lease_id = p_lease_id
    and processed_at is null;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

create or replace function public.fail_inbox_row(
  p_id uuid,
  p_lease_id uuid,
  p_dead_letter boolean,
  p_next_retry_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated integer;
begin
  update public.webhook_inbox
  set dead_lettered = case when p_dead_letter then true else dead_lettered end,
      next_retry_at = case when p_dead_letter then next_retry_at else p_next_retry_at end,
      locked_until = null
  where id = p_id
    and lease_id = p_lease_id
    and processed_at is null;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- commit_lock_reconciliation: the single atomic lock+token authority (finding 5).
-- Updates locks.status/withdrawn_amount AND the projected tokens.trust_tier +
-- tier_computed_at + policy_version in ONE transaction, so lock state and token
-- tier can never diverge between two separate round-trips. The projection is
-- computed by the caller from the canonical lock + persisted github_tier and
-- passed in; this function only commits it transactionally.
-- ---------------------------------------------------------------------------
create or replace function public.commit_lock_reconciliation(
  p_lock_id uuid,
  p_token_id uuid,
  p_status text,
  p_withdrawn_amount numeric,
  p_verified_at timestamptz,
  p_verified_signature text,
  p_verified_slot bigint,
  p_trust_tier int,
  p_policy_version int
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.locks
  set status = p_status,
      withdrawn_amount = p_withdrawn_amount,
      last_verified_at = p_verified_at,
      last_verified_signature = coalesce(p_verified_signature, last_verified_signature),
      last_verified_slot = coalesce(p_verified_slot, last_verified_slot)
  where id = p_lock_id;

  update public.tokens
  set trust_tier = p_trust_tier,
      tier_computed_at = p_verified_at,
      policy_version = p_policy_version
  where id = p_token_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: definer functions run as owner, so they must NOT be callable
-- by PUBLIC/anon/authenticated (Postgres grants execute to PUBLIC by default).
-- Only the server's service_role may invoke them (finding 1).
-- ---------------------------------------------------------------------------
revoke all on function public.claim_webhook_inbox(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_inbox_row(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_inbox_row(uuid, uuid, boolean, timestamptz)
  from public, anon, authenticated;
revoke all on function public.commit_lock_reconciliation(
  uuid, uuid, text, numeric, timestamptz, text, bigint, int, int
) from public, anon, authenticated;

grant execute on function public.claim_webhook_inbox(integer, integer)
  to service_role;
grant execute on function public.complete_inbox_row(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.fail_inbox_row(uuid, uuid, boolean, timestamptz)
  to service_role;
grant execute on function public.commit_lock_reconciliation(
  uuid, uuid, text, numeric, timestamptz, text, bigint, int, int
) to service_role;

commit;
