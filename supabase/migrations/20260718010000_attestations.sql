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

begin;

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
  desired_tier integer not null check (desired_tier between 1 and 4),
  desired_lock_bps integer not null check (desired_lock_bps between 0 and 10000),
  desired_cliff_ts bigint not null check (desired_cliff_ts > 0),
  desired_policy_version integer not null check (desired_policy_version >= 1),
  evidence_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'broadcast', 'done', 'failed', 'dead')),
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
  where status = 'leased';

-- RLS: enabled, no anon/authenticated grants. Server routes use service_role
-- (which bypasses RLS); public reads go through the safe view below.
alter table public.attestations enable row level security;
alter table public.attestation_outbox enable row level security;

revoke all on public.attestations from anon, authenticated;
revoke all on public.attestation_outbox from anon, authenticated;

-- Safe public view: only non-sensitive columns of currently-live attestations,
-- joinable by the trust API. Excludes outbox internals and closed/failed rows.
create or replace view public.attestations_public
with (security_invoker = true)
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
grant select on public.attestations_public to anon, authenticated, service_role;

-- The view reads the RLS-protected base table under security_invoker, so anon
-- needs a scoped select policy matching exactly the view's visible rows.
create policy attestations_public_read on public.attestations
  for select to anon, authenticated
  using (status = 'finalized' and expiry_ts > now());

-- Enqueue a server-derived issuance job. Idempotent per open job: a duplicate
-- enqueue while one is open is a no-op (returns the existing id). Only callable
-- by service_role; never accepts caller-supplied attestation data beyond the
-- server-derived snapshot the trust projection passes in.
create or replace function public.enqueue_attestation_job(
  p_token_id uuid,
  p_cluster text,
  p_mint text,
  p_operation text,
  p_tier integer,
  p_lock_bps integer,
  p_cliff_ts bigint,
  p_policy_version integer,
  p_evidence_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  select id into v_existing
  from public.attestation_outbox
  where token_id = p_token_id
    and status in ('pending', 'leased', 'broadcast')
  limit 1;

  if v_existing is not null then
    -- Refresh the desired snapshot if the open job predates this evidence.
    update public.attestation_outbox
    set desired_tier = p_tier,
        desired_lock_bps = p_lock_bps,
        desired_cliff_ts = p_cliff_ts,
        desired_policy_version = p_policy_version,
        evidence_hash = p_evidence_hash,
        operation = p_operation,
        updated_at = now()
    where id = v_existing
      and status = 'pending'
      and evidence_hash <> p_evidence_hash;
    return v_existing;
  end if;

  insert into public.attestation_outbox (
    token_id, cluster, mint, operation,
    desired_tier, desired_lock_bps, desired_cliff_ts, desired_policy_version,
    evidence_hash
  ) values (
    p_token_id, p_cluster, p_mint, p_operation,
    p_tier, p_lock_bps, p_cliff_ts, p_policy_version,
    p_evidence_hash
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Atomically claim one due outbox row with a lease. Returns the leased row or
-- nothing. Uses skip-locked so concurrent workers never claim the same row.
create or replace function public.claim_attestation_job(
  p_lease_seconds integer default 120
)
returns setof public.attestation_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lease uuid := gen_random_uuid();
begin
  select id into v_id
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
  set status = 'leased',
      lease_token = v_lease,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      updated_at = now()
  where id = v_id
  returning *;
end;
$$;

-- Persist a broadcast intent: signatures stored BEFORE the worker broadcasts, so
-- an ambiguous send reconciles from chain. Guarded by the lease token.
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
    and status = 'leased';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Finalize a job: upsert the attestation row and mark the outbox done. Runs in
-- one transaction so the attestation record and outbox completion commit atomically.
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
  v_generation integer;
  v_attestation_id uuid;
begin
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

  update public.attestation_outbox
  set status = 'done',
      attestation_id = v_attestation_id,
      locked_until = null,
      lease_token = null,
      updated_at = now()
  where id = p_id
    and lease_token = p_lease_token;

  return v_attestation_id;
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
  where id = p_id and lease_token = p_lease_token;

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

revoke all on function public.enqueue_attestation_job(uuid, text, text, text, integer, integer, bigint, integer, text) from public, anon, authenticated;
grant execute on function public.enqueue_attestation_job(uuid, text, text, text, integer, integer, bigint, integer, text) to service_role;
revoke all on function public.claim_attestation_job(integer) from public, anon, authenticated;
grant execute on function public.claim_attestation_job(integer) to service_role;
revoke all on function public.mark_attestation_broadcast(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_attestation_broadcast(uuid, uuid, text, text, integer) to service_role;
revoke all on function public.complete_attestation_job(uuid, uuid, uuid, text, text, text, integer, integer, integer, integer, bigint, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.complete_attestation_job(uuid, uuid, uuid, text, text, text, integer, integer, integer, integer, bigint, text, timestamptz, text, text) to service_role;
revoke all on function public.fail_attestation_job(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_attestation_job(uuid, uuid, text, boolean) to service_role;
revoke all on function public.expire_attestations(integer) from public, anon, authenticated;
grant execute on function public.expire_attestations(integer) to service_role;

commit;
