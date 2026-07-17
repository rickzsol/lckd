-- Integration tests for the attestation outbox RPCs, validated on Postgres 16.
--
-- Run against a throwaway Postgres 16:
--   docker run -d --name lckd-pg16 -e POSTGRES_PASSWORD=postgres \
--     -e POSTGRES_DB=lckd -p 55432:5432 postgres:16
--   docker exec -i lckd-pg16 psql -U postgres -d lckd -v ON_ERROR_STOP=1 <<'SQL'
--     create extension if not exists pgcrypto;
--     create role anon; create role authenticated; create role service_role;
--     create table public.tokens (id uuid primary key default gen_random_uuid());
--   SQL
--   docker exec -i lckd-pg16 psql -U postgres -d lckd -v ON_ERROR_STOP=1 \
--     < supabase/migrations/20260718010000_attestations.sql
--   docker exec -i lckd-pg16 psql -U postgres -d lckd -v ON_ERROR_STOP=1 \
--     < supabase/tests/attestation_outbox_rpcs.test.sql
--
-- Every assertion raises on failure, so a clean run (no exception) is a pass.

begin;

-- Finding 2a: a row recovered from 'broadcast' keeps its status and signature, so
-- the reconciliation completion RPCs (which require status='broadcast') succeed.
--
-- Each block truncates the outbox first: claim_attestation_job picks the globally
-- oldest due row, so leftover jobs from an earlier block would otherwise be claimed
-- in place of this block's job.
do $$
declare
  v_tok uuid; v_job uuid; v_lease uuid; v_from text; v_status text; v_att uuid;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintAAA','issue',1,6500,1893456000,1,1,'hash_a');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_broadcast(v_job, v_lease, 'sig_create_1', null, 120);

  -- Expire the lease so recovery can re-claim the broadcast row.
  update public.attestation_outbox set locked_until = now() - interval '1 minute' where id = v_job;
  select claimed_from_status, (job).lease_token into v_from, v_lease from public.claim_attestation_job(120);
  select status into v_status from public.attestation_outbox where id = v_job;
  assert v_from = 'broadcast', format('2a: claimed_from_status was %s', v_from);
  assert v_status = 'broadcast', format('2a: recovered status was %s, not broadcast', v_status);
  assert exists (select 1 from public.attestation_outbox where id=v_job and pending_signature='sig_create_1'),
    '2a: pending_signature lost on recovery';

  -- The recovered broadcast row completes (guard requires status='broadcast').
  v_att := public.complete_attestation_job(
    v_job, v_lease, v_tok, 'devnet','MintAAA','PdaAAA',
    1,1,1,6500,1893456000,'hash_a','2030-01-01T00:00:00Z','sig_create_1', null);
  assert exists (select 1 from public.attestation_outbox where id=v_job and status='done'), '2a: job not done';
  assert exists (select 1 from public.attestations where id=v_att and status='finalized'), '2a: attestation not finalized';
end $$;

-- Finding 5: the parked successor slot holds only the LATEST desired state.
-- A reissue parks B, advances its create phase to pending, then a newer enqueue C
-- overwrites the live desired and MUST clear the stale successor B, so completion
-- never promotes B over C.
do $$
declare v_tok uuid; v_job uuid; v_lease uuid; v_desired text; v_succ text;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintBBB','reissue',2,5000,1893456000,1,1,'hash_A');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_close_broadcast(v_job, v_lease, 'sig_close_A', 120);

  perform public.enqueue_attestation_job(v_tok,'devnet','MintBBB','reissue',3,5000,1893456000,1,1,'hash_B');
  assert exists (select 1 from public.attestation_outbox where id=v_job and successor_evidence_hash='hash_B'),
    '5: B not parked';

  perform public.advance_reissue_to_create(v_job, v_lease, 'devnet','MintBBB',1,'PdaBBB','sig_close_A');
  perform public.enqueue_attestation_job(v_tok,'devnet','MintBBB','reissue',4,5000,1893456000,1,1,'hash_C');
  select evidence_hash, successor_evidence_hash into v_desired, v_succ
    from public.attestation_outbox where id=v_job;
  assert v_desired = 'hash_C', format('5: desired was %s, not C', v_desired);
  assert v_succ is null, format('5: stale successor %s survived C (would be promoted over C)', v_succ);
end $$;

-- Finding 5b: an enqueue that returns the desired state to what the in-flight job
-- already emits clears a parked successor, so nothing stale is promoted.
do $$
declare v_tok uuid; v_job uuid; v_lease uuid; v_succ text;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintCCC','issue',1,6500,1893456000,1,1,'hash_inflight');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_broadcast(v_job, v_lease, 'sig_x', null, 120);

  perform public.enqueue_attestation_job(v_tok,'devnet','MintCCC','reissue',2,5000,1893456000,1,1,'hash_other');
  assert exists (select 1 from public.attestation_outbox where id=v_job and successor_evidence_hash='hash_other'),
    '5b: successor not parked';

  perform public.enqueue_attestation_job(v_tok,'devnet','MintCCC','issue',1,6500,1893456000,1,1,'hash_inflight');
  select successor_evidence_hash into v_succ from public.attestation_outbox where id=v_job;
  assert v_succ is null, '5b: stale successor survived a return-to-inflight enqueue';
end $$;

-- Finding 10: the lost-insert fallback is idempotent under the partial open-job
-- index. A duplicate open insert must do-nothing (return no id), never 23505.
do $$
declare v_tok uuid; v_id uuid;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  insert into public.attestation_outbox
    (token_id,cluster,mint,operation,desired_tier,desired_lock_bps,desired_cliff_ts,desired_policy_version,desired_schema_version,evidence_hash)
    values (v_tok,'devnet','MintDDD','issue',1,6500,1893456000,1,1,'h1');
  insert into public.attestation_outbox
    (token_id,cluster,mint,operation,desired_tier,desired_lock_bps,desired_cliff_ts,desired_policy_version,desired_schema_version,evidence_hash)
    values (v_tok,'devnet','MintDDD','issue',1,6500,1893456000,1,1,'h2')
    on conflict (token_id) where (status in ('pending','leased','broadcast')) do nothing
    returning id into v_id;
  assert v_id is null, '10: duplicate open insert created a second row instead of do-nothing';
  assert (select count(*) from public.attestation_outbox where token_id=v_tok
          and status in ('pending','leased','broadcast')) = 1,
    '10: more than one open job for the token';
end $$;

rollback;
