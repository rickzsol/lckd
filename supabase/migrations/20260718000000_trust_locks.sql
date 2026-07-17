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
  add column if not exists policy_version int;

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
  constraint locks_withdrawn_le_deposited check (withdrawn_amount <= deposited_amount),
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

-- Calendar/keyset index. Ordering column set matches the (cliff_ts, mint, id)
-- pagination cursor; only rows still visible in the calendar are indexed.
create index if not exists locks_cliff_idx
  on public.locks (cliff_ts, mint, id)
  where status in ('locked', 'unlock_eligible');

-- ---------------------------------------------------------------------------
-- webhook_inbox: durable idempotent landing zone for Helius deliveries.
-- Lease columns drive the cron consumer: claim with locked_until, back off via
-- next_retry_at/attempts, dead-letter after N attempts.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  signature text not null,
  event_index int not null default 0,
  event_type text not null,
  slot bigint,
  payload_hash text not null,
  payload jsonb not null,                 -- bounded, normalized subset only
  attempts int not null default 0,
  locked_until timestamptz,
  next_retry_at timestamptz,
  processed_at timestamptz,
  dead_lettered boolean not null default false,
  received_at timestamptz not null default now(),
  constraint webhook_inbox_attempts_nonneg check (attempts >= 0),
  constraint webhook_inbox_event_index_nonneg check (event_index >= 0),
  unique (provider, signature, event_index, event_type)
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
-- tokens_select policy: launch + lock verified). No signatures, no slots, no
-- escrow/recipient internals beyond what the trust API already exposes.
create or replace view public.locks_public
with (security_invoker = true) as
select
  l.id,
  l.token_id,
  l.mint,
  l.stream_program,
  l.stream_id,
  l.recipient,
  l.deposited_amount,
  l.withdrawn_amount,
  l.total_supply_raw,
  l.decimals,
  l.lock_bps,
  l.cliff_ts,
  l.status,
  l.canonical,
  l.last_verified_at
from public.locks l
join public.tokens t on t.id = l.token_id
where t.launch_verified_at is not null
  and t.lock_verified_at is not null;

grant select on public.locks_public to anon, authenticated;

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
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid claim limit' using errcode = '22023';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'Invalid lease window' using errcode = '22023';
  end if;

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
      attempts = w.attempts + 1
  from claimable c
  where w.id = c.id
  returning w.*;
end;
$$;

commit;
