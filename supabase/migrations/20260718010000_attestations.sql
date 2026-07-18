-- SAS attestations: on-chain trust credential state + durable issuance outbox.
--
-- attestations records every issuance generation for a token's trust tier.
-- Closure never rewrites history: a reissue is generation + 1 on the same PDA,
-- the prior row keeps its evidence. A scheduled job flips finalized -> expired
-- when expiry_ts passes, freeing the active slot.
--
-- attestation_outbox is the bridge between Postgres and irreversible on-chain
-- effects (which cannot be transactionally committed together). Rows are leased
-- with backoff and dead-lettered after N attempts. The transaction signature is
-- persisted BEFORE broadcast so an ambiguous outcome reconciles from chain.
--
-- Reissue is modelled as TWO durable phases: a close phase (operation 'close')
-- followed by a create phase (operation 'issue'), each with its own persisted
-- signature and its own reconciliation. A single-transaction close+create was
-- deliberately NOT used because it cannot be reconciled by one signature when the
-- send is ambiguous, and devnet verification of that path is unavailable here.

begin;

-- Finalized supply basis (raw base units) that trust attestations use as the
-- lock basis-point denominator. Persisted at record time so BOTH the record
-- trigger and the tier-recompute cron derive the SAME lock_bps, keeping the
-- enqueued evidence hash and the worker's reconstruction in agreement.
-- TODO(trust-api): superseded by the canonical finalized total supply once
-- feature/trust-api lands.
alter table public.tokens
  add column if not exists sas_supply_basis text;

-- Durable revocation marker. Set atomically with an expired-lock downgrade so the
-- on-chain close is never lost to a transient enqueue failure OR an in-flight
-- issuance whose attestation row does not exist yet: the cron re-drives every
-- token still carrying the marker until the close is durably enqueued (or there is
-- provably nothing to revoke), then clears it. Without this, a downgrade committed
-- before a best-effort close swallowed the failure and permanently missed
-- revocation.
alter table public.tokens
  add column if not exists sas_close_pending boolean not null default false;

create index if not exists tokens_sas_close_pending_idx
  on public.tokens (id)
  where sas_close_pending;

create table if not exists public.attestations (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  cluster text not null,
  mint text not null,
  tier integer not null check (tier between 1 and 4),
  policy_version integer not null check (policy_version >= 1),
  schema_version integer not null check (schema_version >= 1),
  lock_bps integer not null check (lock_bps between 0 and 10000),
  cliff_ts_raw bigint not null check (cliff_ts_raw > 0),
  evidence_hash text not null,
  attestation_pda text not null,
  generation integer not null default 1 check (generation >= 1),
  expiry_ts timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'finalized', 'expired', 'failed', 'closed')),
  tx_signature text,
  close_signature text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attestation_pda, generation)
);

-- One live attestation per (cluster, mint, schema_version). pending/submitted/
-- finalized all hold the slot; expiry or closure frees it for a reissue.
create unique index if not exists attestations_active_idx
  on public.attestations (cluster, mint, schema_version)
  where status in ('pending', 'submitted', 'finalized');

create index if not exists attestations_token_idx
  on public.attestations (token_id);

create index if not exists attestations_expiry_sweep_idx
  on public.attestations (expiry_ts)
  where status = 'finalized';

create table if not exists public.attestation_outbox (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  attestation_id uuid references public.attestations(id) on delete set null,
  cluster text not null,
  mint text not null,
  operation text not null check (operation in ('issue', 'reissue', 'close')),
  -- Server-derived desired payload snapshot; NO caller input flows into this.
  -- Both policy_version AND schema_version are pinned at enqueue so a deployment
  -- between enqueue and processing can never make the persisted attestation
  -- disagree with what was actually issued on chain.
  desired_tier integer not null check (desired_tier between 1 and 4),
  desired_lock_bps integer not null check (desired_lock_bps between 0 and 10000),
  desired_cliff_ts bigint not null check (desired_cliff_ts > 0),
  desired_policy_version integer not null check (desired_policy_version >= 1),
  desired_schema_version integer not null check (desired_schema_version >= 1),
  evidence_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'broadcast', 'done', 'failed', 'dead')),
  -- Durable "latest desired state" marker. When trust evidence changes while a
  -- job is already leased/broadcast (cannot be safely mutated in place), the new
  -- snapshot is parked here and promoted to the live columns once the current
  -- job finishes, so a change during in-flight work is never silently lost.
  successor_evidence_hash text,
  successor_tier integer check (successor_tier between 1 and 4),
  successor_lock_bps integer check (successor_lock_bps between 0 and 10000),
  successor_cliff_ts bigint check (successor_cliff_ts > 0),
  successor_policy_version integer check (successor_policy_version >= 1),
  successor_schema_version integer check (successor_schema_version >= 1),
  successor_operation text check (successor_operation in ('issue', 'reissue', 'close')),
  -- Lease + backoff columns.
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_until timestamptz,
  lease_token uuid,
  next_retry_at timestamptz not null default now(),
  -- Ambiguous-outcome reconciliation: signatures persisted BEFORE broadcast.
  pending_signature text,
  pending_close_signature text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one open outbox job per token; extras must aggregate explicitly
-- rather than racing duplicate on-chain effects.
create unique index if not exists attestation_outbox_open_idx
  on public.attestation_outbox (token_id)
  where status in ('pending', 'leased', 'broadcast');

create index if not exists attestation_outbox_claim_idx
  on public.attestation_outbox (next_retry_at)
  where status in ('pending', 'failed');

create index if not exists attestation_outbox_lease_idx
  on public.attestation_outbox (locked_until)
  where status in ('leased', 'broadcast');

-- RLS: enabled, no anon/authenticated grants. Server routes use service_role
-- (which bypasses RLS); public reads go through the owner-executed view below.
alter table public.attestations enable row level security;
alter table public.attestation_outbox enable row level security;

revoke all on public.attestations from anon, authenticated;
revoke all on public.attestation_outbox from anon, authenticated;

-- Safe public view: a TIGHTLY PROJECTED, OWNER-EXECUTED view. It runs as its
-- postgres owner (security_invoker = false / default), so anon reads the visible
-- columns of currently-live attestations WITHOUT any base-table grant or RLS
-- policy on public.attestations. Only these non-sensitive columns are exposed;
-- outbox internals, evidence hashes, and closed/failed rows never surface.
create or replace view public.attestations_public
with (security_invoker = false)
as
  select
    token_id,
    cluster,
    mint,
    tier,
    policy_version,
    schema_version,
    lock_bps,
    cliff_ts_raw,
    attestation_pda,
    generation,
    expiry_ts,
    tx_signature
  from public.attestations
  where status = 'finalized'
    and expiry_ts > now();

alter view public.attestations_public owner to postgres;
revoke all on public.attestations_public from public;
grant select on public.attestations_public to anon, authenticated, service_role;

-- Enqueue a server-derived issuance job. Concurrency-safe and idempotent:
--   * First enqueue races are resolved by an atomic INSERT ... ON CONFLICT on the
--     partial unique index (one open job per token), so two concurrent first
--     enqueues never both fail the index.
--   * A pending open job is updated in place with the newer snapshot, and any
--     parked successor is cleared (the live columns now hold the latest state).
--   * A leased/broadcast open job cannot be safely mutated (a worker holds it),
--     so the newer snapshot is parked in the successor_* columns and promoted
--     once the current job completes. The successor slot holds ONLY the latest
--     desired state: a newer enqueue overwrites it, and an enqueue that returns
--     the desired state to the in-flight claim clears it. Promotion therefore
--     never resurrects a stale snapshot. Nothing is silently lost.
-- Only callable by service_role; never accepts caller-supplied attestation data
-- beyond the server-derived snapshot the trust projection passes in.
create or replace function public.enqueue_attestation_job(
  p_token_id uuid,
  p_cluster text,
  p_mint text,
  p_operation text,
  p_tier integer,
  p_lock_bps integer,
  p_cliff_ts bigint,
  p_policy_version integer,
  p_schema_version integer,
  p_evidence_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attestation_outbox%rowtype;
  v_id uuid;
  v_found boolean;
begin
  -- Lock the open row for this token, if any, so the leased/broadcast branch
  -- observes a stable status and the successor write is race-free.
  select * into v_existing
  from public.attestation_outbox
  where token_id = p_token_id
    and status in ('pending', 'leased', 'broadcast')
  for update
  limit 1;

  if found then
    if v_existing.status = 'pending' then
      -- Safe to mutate in place: no worker holds a pending job. Updating the live
      -- desired columns makes THEM the latest desired state, so any previously
      -- parked successor is now stale and MUST be cleared UNCONDITIONALLY: even
      -- when the evidence hash is unchanged, a stale successor left behind would be
      -- promoted on completion. Concretely: a reissue parks an older successor B,
      -- advances its create phase to pending, then a same-hash re-enqueue A must
      -- still drop B. So the successor is cleared whenever a job is (re)enqueued to
      -- a pending open row, independent of hash equality. The live columns refresh
      -- when the hash OR the operation differs (a same-hash close after a prior
      -- issue changes the operation but not the hash, and must still take effect).
      update public.attestation_outbox
      set desired_tier = p_tier,
          desired_lock_bps = p_lock_bps,
          desired_cliff_ts = p_cliff_ts,
          desired_policy_version = p_policy_version,
          desired_schema_version = p_schema_version,
          evidence_hash = p_evidence_hash,
          operation = p_operation,
          successor_evidence_hash = null,
          successor_tier = null,
          successor_lock_bps = null,
          successor_cliff_ts = null,
          successor_policy_version = null,
          successor_schema_version = null,
          successor_operation = null,
          updated_at = now()
      where id = v_existing.id;
      return v_existing.id;
    end if;

    -- Leased or broadcast: the in-flight job holds the current desired state; the
    -- successor slot must hold the LATEST desired state that differs from it.
    -- Equality must include the OPERATION, not just the hash: a same-hash close
    -- after a prior issue leaves the hash unchanged but changes the operation, and
    -- must NOT be discarded as "returned to in-flight".
    --   * differs from in-flight (hash OR operation)
    --                             -> overwrite successor with this newest snapshot
    --     (a prior successor is stale and is replaced, not merged).
    --   * equals in-flight (hash AND operation)
    --                             -> the desired state returned to what is already
    --     being emitted, so any parked successor is stale: clear it.
    if v_existing.evidence_hash <> p_evidence_hash
       or v_existing.operation <> p_operation then
      update public.attestation_outbox
      set successor_evidence_hash = p_evidence_hash,
          successor_tier = p_tier,
          successor_lock_bps = p_lock_bps,
          successor_cliff_ts = p_cliff_ts,
          successor_policy_version = p_policy_version,
          successor_schema_version = p_schema_version,
          successor_operation = p_operation,
          updated_at = now()
      where id = v_existing.id;
    elsif v_existing.successor_evidence_hash is not null then
      update public.attestation_outbox
      set successor_evidence_hash = null,
          successor_tier = null,
          successor_lock_bps = null,
          successor_cliff_ts = null,
          successor_policy_version = null,
          successor_schema_version = null,
          successor_operation = null,
          updated_at = now()
      where id = v_existing.id;
    end if;
    return v_existing.id;
  end if;

  -- No open job: create one. This is a bounded INSERT/SELECT retry loop rather
  -- than a fixed two-attempt sequence, because the two operations race a concurrent
  -- worker independently:
  --   * INSERT ... ON CONFLICT DO NOTHING inserts our fresh job, OR does nothing
  --     because a concurrent enqueue already opened one (index conflict).
  --   * On do-nothing we SELECT the open job FOR UPDATE to refresh/park it. But the
  --     winning job can COMPLETE (leave the open states) between our failed insert
  --     and this select, so the select finds nothing.
  -- The two can leapfrog: insert loses to a winner, winner completes before the
  -- select, so neither an insert nor a found row results on a single pass. A fixed
  -- two-attempt sequence RAISED here and dropped the enqueue. Instead we loop:
  -- re-attempt the insert; if it still does nothing, re-select; keep going until we
  -- either insert a fresh job or lock an existing open one. Bounded so a pathological
  -- livelock cannot spin forever; the bound is far above any real contention.
  v_found := false;
  for v_attempt in 1..50 loop
    insert into public.attestation_outbox (
      token_id, cluster, mint, operation,
      desired_tier, desired_lock_bps, desired_cliff_ts,
      desired_policy_version, desired_schema_version, evidence_hash
    ) values (
      p_token_id, p_cluster, p_mint, p_operation,
      p_tier, p_lock_bps, p_cliff_ts,
      p_policy_version, p_schema_version, p_evidence_hash
    )
    on conflict (token_id) where (status in ('pending', 'leased', 'broadcast'))
    do nothing
    returning id into v_id;

    if v_id is not null then
      -- Inserted a fresh open job: nothing to refresh or park.
      return v_id;
    end if;

    -- Insert did nothing: a concurrent enqueue holds the open slot. Try to lock it.
    select * into v_existing
    from public.attestation_outbox
    where token_id = p_token_id
      and status in ('pending', 'leased', 'broadcast')
    for update
    limit 1;

    if found then
      v_found := true;
      exit;
    end if;
    -- The winner completed between our insert and this select: no open row and no
    -- insert. Loop and retry the insert rather than raising and dropping the enqueue.
  end loop;

  if not v_found then
    raise exception 'enqueue_attestation_job: could not open or lock a job for token % after retries', p_token_id;
  end if;

  if v_existing.status = 'pending' then
    -- See the pending branch above: refreshing the live desired columns makes them
    -- the latest snapshot, so any stale parked successor is cleared here too, and
    -- UNCONDITIONALLY (independent of hash equality) so a same-hash re-enqueue that
    -- returns the job to pending still drops a parked successor.
    update public.attestation_outbox
    set desired_tier = p_tier,
        desired_lock_bps = p_lock_bps,
        desired_cliff_ts = p_cliff_ts,
        desired_policy_version = p_policy_version,
        desired_schema_version = p_schema_version,
        evidence_hash = p_evidence_hash,
        operation = p_operation,
        successor_evidence_hash = null,
        successor_tier = null,
        successor_lock_bps = null,
        successor_cliff_ts = null,
        successor_policy_version = null,
        successor_schema_version = null,
        successor_operation = null,
        updated_at = now()
    where id = v_existing.id;
  elsif v_existing.status in ('leased', 'broadcast')
    and (v_existing.evidence_hash <> p_evidence_hash
         or v_existing.operation <> p_operation) then
    -- Differs from the in-flight job by hash OR operation: park as successor.
    update public.attestation_outbox
    set successor_evidence_hash = p_evidence_hash,
        successor_tier = p_tier,
        successor_lock_bps = p_lock_bps,
        successor_cliff_ts = p_cliff_ts,
        successor_policy_version = p_policy_version,
        successor_schema_version = p_schema_version,
        successor_operation = p_operation,
        updated_at = now()
    where id = v_existing.id;
  elsif v_existing.status in ('leased', 'broadcast')
    and v_existing.evidence_hash = p_evidence_hash
    and v_existing.operation = p_operation
    and v_existing.successor_evidence_hash is not null then
    -- Desired state returned to what the in-flight job already emits: drop the
    -- now-stale parked successor so completion does not promote it.
    update public.attestation_outbox
    set successor_evidence_hash = null,
        successor_tier = null,
        successor_lock_bps = null,
        successor_cliff_ts = null,
        successor_policy_version = null,
        successor_schema_version = null,
        successor_operation = null,
        updated_at = now()
    where id = v_existing.id;
  end if;
  return v_existing.id;
end;
$$;

-- Atomically claim one due outbox row with a lease. Returns the leased row and
-- the status it was claimed FROM (so the worker reconciles a prior broadcast
-- instead of blindly resending). Uses skip-locked so concurrent workers never
-- claim the same row.
--
-- A row recovered from 'broadcast' KEEPS status 'broadcast' (only pending/failed/
-- leased rows move to 'leased'). The reconciliation completion RPCs require
-- status = 'broadcast', so forcing every claim to 'leased' would make a recovered
-- broadcast row fail reconciliation. Preserving the claimed-from status lets a
-- recovered broadcast reconcile against its persisted signature; the lease token
-- and locked_until still fence a stale worker either way.
create or replace function public.claim_attestation_job(
  p_lease_seconds integer default 120
)
returns table (job public.attestation_outbox, claimed_from_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_from text;
  v_lease uuid := gen_random_uuid();
begin
  select id, status into v_id, v_from
  from public.attestation_outbox
  where (
      (status in ('pending', 'failed') and next_retry_at <= now())
      or (status = 'leased' and locked_until < now())
      or (status = 'broadcast' and locked_until < now())
    )
    and attempts < max_attempts
  order by next_retry_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.attestation_outbox
  set status = case when v_from = 'broadcast' then 'broadcast' else 'leased' end,
      lease_token = v_lease,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      updated_at = now()
  where id = v_id
  returning attestation_outbox, v_from;
end;
$$;

-- Persist a broadcast intent: signatures stored BEFORE the worker broadcasts, so
-- an ambiguous send reconciles from chain. Guarded by the lease token. Accepts a
-- row in 'leased' (normal first broadcast) OR 'broadcast' (a recovered broadcast
-- whose prior signature never landed and is being re-driven with a fresh one):
-- the lease token still fences a stale worker, and overwriting pending_signature
-- with the new attempt is exactly what a re-drive needs.
create or replace function public.mark_attestation_broadcast(
  p_id uuid,
  p_lease_token uuid,
  p_signature text,
  p_close_signature text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.attestation_outbox
  set status = 'broadcast',
      pending_signature = p_signature,
      pending_close_signature = p_close_signature,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_id
    and lease_token = p_lease_token
    and status in ('leased', 'broadcast');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Persist the reissue CLOSE-phase signature before its broadcast. Unlike
-- mark_attestation_broadcast this stores ONLY pending_close_signature and leaves
-- pending_signature null, so reconciliation can tell the create half has not yet
-- landed and never mistakes a close signature for a create. Accepts 'leased' or
-- 'broadcast' (a recovered close being re-driven with a fresh signature).
create or replace function public.mark_attestation_close_broadcast(
  p_id uuid,
  p_lease_token uuid,
  p_close_signature text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.attestation_outbox
  set status = 'broadcast',
      pending_signature = null,
      pending_close_signature = p_close_signature,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_id
    and lease_token = p_lease_token
    and status in ('leased', 'broadcast');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Complete the reissue CLOSE phase: close the live DB row (no generation) and
-- flip the SAME job to its CREATE phase (operation 'issue', status 'pending',
-- signatures cleared, attempts reset). The create then runs as its own durable
-- claim with its own lease, signature, and reconciliation. Lease/status/close-
-- signature fenced against a stale worker.
create or replace function public.advance_reissue_to_create(
  p_id uuid,
  p_lease_token uuid,
  p_cluster text,
  p_mint text,
  p_schema_version integer,
  p_attestation_pda text,
  p_close_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attestation_outbox%rowtype;
begin
  select * into v_row
  from public.attestation_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'attestation job % not found', p_id;
  end if;
  if v_row.lease_token is distinct from p_lease_token then
    raise exception 'attestation job % lease mismatch (stale worker)', p_id;
  end if;
  if v_row.status <> 'broadcast' then
    raise exception 'attestation job % not in broadcast status (was %)', p_id, v_row.status;
  end if;
  if v_row.pending_close_signature is distinct from p_close_signature then
    raise exception 'attestation job % close signature mismatch', p_id;
  end if;

  update public.attestations
  set status = 'closed',
      close_signature = coalesce(p_close_signature, close_signature),
      closed_at = now(),
      updated_at = now()
  where cluster = p_cluster
    and mint = p_mint
    and schema_version = p_schema_version
    and status in ('pending', 'submitted', 'finalized')
    and attestation_pda = p_attestation_pda;

  update public.attestation_outbox
  set operation = 'issue',
      status = 'pending',
      attempts = 0,
      next_retry_at = now(),
      locked_until = null,
      lease_token = null,
      pending_signature = null,
      -- Retain the close signature so the eventual create completion can record
      -- which close preceded this generation.
      updated_at = now()
  where id = p_id;
end;
$$;

-- Promote any parked successor snapshot into the live desired columns and reopen
-- the job as 'pending' for the next processing pass. Returns true when a
-- successor was promoted (the job stays open), false when there was none (the
-- caller marks the job done). Lease-guarded; validates the row is still ours.
create or replace function public.promote_successor_or_done(
  p_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attestation_outbox%rowtype;
begin
  select * into v_row
  from public.attestation_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'attestation job % not found', p_id;
  end if;
  if v_row.lease_token is distinct from p_lease_token then
    raise exception 'attestation job % lease mismatch', p_id;
  end if;

  if v_row.successor_evidence_hash is null then
    return false;
  end if;

  update public.attestation_outbox
  set operation = coalesce(v_row.successor_operation, operation),
      desired_tier = v_row.successor_tier,
      desired_lock_bps = v_row.successor_lock_bps,
      desired_cliff_ts = v_row.successor_cliff_ts,
      desired_policy_version = v_row.successor_policy_version,
      desired_schema_version = v_row.successor_schema_version,
      evidence_hash = v_row.successor_evidence_hash,
      status = 'pending',
      attempts = 0,
      next_retry_at = now(),
      locked_until = null,
      lease_token = null,
      pending_signature = null,
      pending_close_signature = null,
      successor_evidence_hash = null,
      successor_tier = null,
      successor_lock_bps = null,
      successor_cliff_ts = null,
      successor_policy_version = null,
      successor_schema_version = null,
      successor_operation = null,
      updated_at = now()
  where id = p_id;
  return true;
end;
$$;

-- Finalize a CREATE/REISSUE job: upsert the attestation generation and mark the
-- outbox done (or reopen it if a successor is parked). Everything runs in one
-- transaction so the attestation record and outbox state commit atomically.
--
-- The outbox row is locked and validated (lease token, status, and the persisted
-- pending_signature) BEFORE any attestation mutation. A stale worker that lost
-- its lease therefore cannot insert a generation or close a prior row: validation
-- raises and the whole transaction rolls back.
create or replace function public.complete_attestation_job(
  p_id uuid,
  p_lease_token uuid,
  p_token_id uuid,
  p_cluster text,
  p_mint text,
  p_attestation_pda text,
  p_tier integer,
  p_policy_version integer,
  p_schema_version integer,
  p_lock_bps integer,
  p_cliff_ts bigint,
  p_evidence_hash text,
  p_expiry_ts timestamptz,
  p_tx_signature text,
  p_close_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attestation_outbox%rowtype;
  v_generation integer;
  v_attestation_id uuid;
  v_promoted boolean;
begin
  -- Fence: lock and validate the outbox row before touching attestations.
  select * into v_row
  from public.attestation_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'attestation job % not found', p_id;
  end if;
  if v_row.lease_token is distinct from p_lease_token then
    raise exception 'attestation job % lease mismatch (stale worker)', p_id;
  end if;
  if v_row.status <> 'broadcast' then
    raise exception 'attestation job % not in broadcast status (was %)', p_id, v_row.status;
  end if;
  if v_row.pending_signature is distinct from p_tx_signature then
    raise exception 'attestation job % signature mismatch', p_id;
  end if;

  -- Expire any prior live rows for this slot so the active index frees.
  update public.attestations
  set status = 'closed',
      close_signature = coalesce(p_close_signature, close_signature),
      closed_at = now(),
      updated_at = now()
  where cluster = p_cluster
    and mint = p_mint
    and schema_version = p_schema_version
    and status in ('pending', 'submitted', 'finalized')
    and attestation_pda = p_attestation_pda;

  select coalesce(max(generation), 0) + 1 into v_generation
  from public.attestations
  where attestation_pda = p_attestation_pda;

  insert into public.attestations (
    token_id, cluster, mint, tier, policy_version, schema_version,
    lock_bps, cliff_ts_raw, evidence_hash, attestation_pda, generation,
    expiry_ts, status, tx_signature, close_signature
  ) values (
    p_token_id, p_cluster, p_mint, p_tier, p_policy_version, p_schema_version,
    p_lock_bps, p_cliff_ts, p_evidence_hash, p_attestation_pda, v_generation,
    p_expiry_ts, 'finalized', p_tx_signature, p_close_signature
  )
  returning id into v_attestation_id;

  -- If a newer desired state arrived while we worked, reopen for another pass;
  -- otherwise close the outbox row out.
  if v_row.successor_evidence_hash is not null then
    v_promoted := public.promote_successor_or_done(p_id, p_lease_token);
    update public.attestation_outbox
    set attestation_id = v_attestation_id
    where id = p_id;
  else
    update public.attestation_outbox
    set status = 'done',
        attestation_id = v_attestation_id,
        locked_until = null,
        lease_token = null,
        pending_signature = null,
        pending_close_signature = null,
        updated_at = now()
    where id = p_id;
  end if;

  return v_attestation_id;
end;
$$;

-- Finalize a CLOSE job: close the active DB attestation row WITHOUT inserting a
-- new generation (nothing exists on chain to record), then mark the outbox done
-- (or reopen for a parked successor). Same lease/status/signature fence as
-- complete_attestation_job so a stale worker cannot mutate state.
create or replace function public.complete_close_attestation_job(
  p_id uuid,
  p_lease_token uuid,
  p_cluster text,
  p_mint text,
  p_schema_version integer,
  p_attestation_pda text,
  p_close_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attestation_outbox%rowtype;
begin
  select * into v_row
  from public.attestation_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'attestation job % not found', p_id;
  end if;
  if v_row.lease_token is distinct from p_lease_token then
    raise exception 'attestation job % lease mismatch (stale worker)', p_id;
  end if;
  if v_row.status <> 'broadcast' then
    raise exception 'attestation job % not in broadcast status (was %)', p_id, v_row.status;
  end if;
  if v_row.pending_signature is distinct from p_close_signature then
    raise exception 'attestation job % close signature mismatch', p_id;
  end if;

  update public.attestations
  set status = 'closed',
      close_signature = coalesce(p_close_signature, close_signature),
      closed_at = now(),
      updated_at = now()
  where cluster = p_cluster
    and mint = p_mint
    and schema_version = p_schema_version
    and status in ('pending', 'submitted', 'finalized')
    and attestation_pda = p_attestation_pda;

  if v_row.successor_evidence_hash is not null then
    perform public.promote_successor_or_done(p_id, p_lease_token);
  else
    update public.attestation_outbox
    set status = 'done',
        locked_until = null,
        lease_token = null,
        pending_signature = null,
        pending_close_signature = null,
        updated_at = now()
    where id = p_id;
  end if;
end;
$$;

-- Finish a job that required NO on-chain effect: an idempotent skip (the live PDA
-- already matches the desired claim) or a close whose account was already absent.
-- No signature is recorded and no generation is inserted; when p_close_live is
-- true any live DB rows for the slot are closed (used by the absent-close path).
-- Lease/status-fenced against a stale worker. Reopens for a parked successor.
create or replace function public.finish_attestation_job_noop(
  p_id uuid,
  p_lease_token uuid,
  p_cluster text,
  p_mint text,
  p_schema_version integer,
  p_attestation_pda text,
  p_close_live boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attestation_outbox%rowtype;
begin
  select * into v_row
  from public.attestation_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'attestation job % not found', p_id;
  end if;
  if v_row.lease_token is distinct from p_lease_token then
    raise exception 'attestation job % lease mismatch (stale worker)', p_id;
  end if;
  if v_row.status not in ('leased', 'broadcast') then
    raise exception 'attestation job % not leased/broadcast (was %)', p_id, v_row.status;
  end if;

  if p_close_live then
    update public.attestations
    set status = 'closed',
        closed_at = now(),
        updated_at = now()
    where cluster = p_cluster
      and mint = p_mint
      and schema_version = p_schema_version
      and status in ('pending', 'submitted', 'finalized')
      and attestation_pda = p_attestation_pda;
  end if;

  if v_row.successor_evidence_hash is not null then
    perform public.promote_successor_or_done(p_id, p_lease_token);
  else
    update public.attestation_outbox
    set status = 'done',
        locked_until = null,
        lease_token = null,
        pending_signature = null,
        pending_close_signature = null,
        updated_at = now()
    where id = p_id;
  end if;
end;
$$;

-- Release a job back to the queue with backoff, or dead-letter it once attempts
-- are exhausted. p_permanent forces dead-letter (non-retryable errors).
create or replace function public.fail_attestation_job(
  p_id uuid,
  p_lease_token uuid,
  p_error text,
  p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_max integer;
  v_status text;
  v_backoff integer;
begin
  select attempts, max_attempts into v_attempts, v_max
  from public.attestation_outbox
  where id = p_id and lease_token = p_lease_token
  for update;

  if v_attempts is null then
    return 'not_leased';
  end if;

  if p_permanent or v_attempts >= v_max then
    v_status := 'dead';
    update public.attestation_outbox
    set status = 'dead',
        last_error = p_error,
        locked_until = null,
        lease_token = null,
        updated_at = now()
    where id = p_id;
  else
    v_status := 'failed';
    -- Exponential backoff: 2^attempts seconds, capped at 15 minutes.
    v_backoff := least(power(2, v_attempts)::integer, 900);
    update public.attestation_outbox
    set status = 'failed',
        last_error = p_error,
        locked_until = null,
        lease_token = null,
        next_retry_at = now() + make_interval(secs => v_backoff),
        updated_at = now()
    where id = p_id;
  end if;

  return v_status;
end;
$$;

-- Back off a broadcast job that has landed but not yet finalized. A confirmed
-- (not finalized) signature has NOT failed: the effect is on chain and the job
-- must reconcile the SAME signature once it finalizes. Routing this through
-- fail_attestation_job would flip the row to 'failed', and the next claim would
-- then move it 'failed' -> 'leased', so the finalized-reconciliation completion
-- RPCs (which require status='broadcast') would raise. So this KEEPS status
-- 'broadcast', retains both pending signatures, releases the lease, and pushes
-- locked_until / next_retry_at out by a bounded backoff. attempts is NOT
-- incremented: waiting for finalization must never burn the dead-letter budget.
-- Lease-guarded; a stale worker whose lease no longer matches is a no-op.
create or replace function public.backoff_attestation_broadcast(
  p_id uuid,
  p_lease_token uuid,
  p_backoff_seconds integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.attestation_outbox
  set locked_until = now() + make_interval(secs => p_backoff_seconds),
      next_retry_at = now() + make_interval(secs => p_backoff_seconds),
      lease_token = null,
      updated_at = now()
  where id = p_id
    and lease_token = p_lease_token
    and status = 'broadcast';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Sweep finalized attestations past their expiry into 'expired', freeing the
-- active slot. Bounded per call so it never scans the whole table at once.
create or replace function public.expire_attestations(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select id
    from public.attestations
    where status = 'finalized'
      and expiry_ts <= now()
    order by expiry_ts asc
    limit p_limit
  )
  update public.attestations a
  set status = 'expired', updated_at = now()
  from due
  where a.id = due.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_attestation_job(uuid, text, text, text, integer, integer, bigint, integer, integer, text) from public, anon, authenticated;
grant execute on function public.enqueue_attestation_job(uuid, text, text, text, integer, integer, bigint, integer, integer, text) to service_role;
revoke all on function public.claim_attestation_job(integer) from public, anon, authenticated;
grant execute on function public.claim_attestation_job(integer) to service_role;
revoke all on function public.mark_attestation_broadcast(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_attestation_broadcast(uuid, uuid, text, text, integer) to service_role;
revoke all on function public.mark_attestation_close_broadcast(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_attestation_close_broadcast(uuid, uuid, text, integer) to service_role;
revoke all on function public.advance_reissue_to_create(uuid, uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.advance_reissue_to_create(uuid, uuid, text, text, integer, text, text) to service_role;
revoke all on function public.promote_successor_or_done(uuid, uuid) from public, anon, authenticated;
grant execute on function public.promote_successor_or_done(uuid, uuid) to service_role;
revoke all on function public.complete_attestation_job(uuid, uuid, uuid, text, text, text, integer, integer, integer, integer, bigint, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.complete_attestation_job(uuid, uuid, uuid, text, text, text, integer, integer, integer, integer, bigint, text, timestamptz, text, text) to service_role;
revoke all on function public.complete_close_attestation_job(uuid, uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.complete_close_attestation_job(uuid, uuid, text, text, integer, text, text) to service_role;
revoke all on function public.finish_attestation_job_noop(uuid, uuid, text, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_attestation_job_noop(uuid, uuid, text, text, integer, text, boolean) to service_role;
revoke all on function public.fail_attestation_job(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_attestation_job(uuid, uuid, text, boolean) to service_role;
revoke all on function public.backoff_attestation_broadcast(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.backoff_attestation_broadcast(uuid, uuid, integer) to service_role;
revoke all on function public.expire_attestations(integer) from public, anon, authenticated;
grant execute on function public.expire_attestations(integer) to service_role;

commit;
