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

-- Item 2b: a confirmed-but-not-finalized signature must NOT move the row out of
-- 'broadcast'. backoff_attestation_broadcast keeps status='broadcast' with the
-- signature intact and only bumps the backoff, so the finalized-reconciliation
-- completion RPCs (which require status='broadcast') still apply on a later claim.
-- Routing this through fail_attestation_job would flip it to 'failed', and the next
-- claim would move it 'failed' -> 'leased', breaking reconciliation.
do $$
declare v_tok uuid; v_job uuid; v_lease uuid; v_status text; v_att uuid; v_ok boolean; v_from text;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintWAIT','issue',1,6500,1893456000,1,1,'hash_wait');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_broadcast(v_job, v_lease, 'sig_wait', null, 120);

  -- Simulate the worker seeing 'confirmed' (not finalized): back off.
  v_ok := public.backoff_attestation_broadcast(v_job, v_lease, 5);
  assert v_ok, '2b: backoff did not update the row';
  select status into v_status from public.attestation_outbox where id = v_job;
  assert v_status = 'broadcast', format('2b: status left broadcast (was %s)', v_status);
  assert exists (select 1 from public.attestation_outbox where id=v_job and pending_signature='sig_wait'),
    '2b: pending_signature lost on backoff';
  -- attempts must NOT be incremented by a wait (it is not a failure).
  assert (select attempts from public.attestation_outbox where id=v_job) = 1,
    '2b: attempts incremented by a finalization wait';
  -- Lease released, so recovery re-claims the still-broadcast row after the backoff.
  update public.attestation_outbox set locked_until = now() - interval '1 minute' where id = v_job;
  select claimed_from_status, (job).lease_token into v_from, v_lease from public.claim_attestation_job(120);
  assert v_from = 'broadcast', format('2b: re-claim from was %s, not broadcast', v_from);

  -- Once finalized, the completion RPC (requires status='broadcast') succeeds.
  v_att := public.complete_attestation_job(
    v_job, v_lease, v_tok, 'devnet','MintWAIT','PdaWAIT',
    1,1,1,6500,1893456000,'hash_wait','2030-01-01T00:00:00Z','sig_wait', null);
  assert exists (select 1 from public.attestations where id=v_att and status='finalized'),
    '2b: attestation not finalized after wait->broadcast->complete';

  -- A stale lease token must not back off the row.
  assert public.backoff_attestation_broadcast(v_job, gen_random_uuid(), 5) = false,
    '2b: backoff succeeded with a wrong lease token';
end $$;

-- Item 5 (unconditional clear): a same-hash re-enqueue that returns a job to
-- PENDING must clear a parked successor, not only when the hash changes. A reissue
-- parks B, advances its create phase to pending, then a same-hash re-enqueue A must
-- still drop B so completion never promotes it.
do $$
declare v_tok uuid; v_job uuid; v_lease uuid; v_succ text; v_desired text;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintSAME','reissue',2,5000,1893456000,1,1,'hash_A');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_close_broadcast(v_job, v_lease, 'sig_close_A', 120);

  -- Park successor B while the close is in flight.
  perform public.enqueue_attestation_job(v_tok,'devnet','MintSAME','reissue',3,5000,1893456000,1,1,'hash_B');
  assert exists (select 1 from public.attestation_outbox where id=v_job and successor_evidence_hash='hash_B'),
    '5-uncond: B not parked';

  -- Advance to the create phase (status pending, desired = create-phase snapshot).
  perform public.advance_reissue_to_create(v_job, v_lease, 'devnet','MintSAME',1,'PdaSAME','sig_close_A');
  -- Set the live desired hash to A so the re-enqueue below is SAME-hash on a pending row.
  update public.attestation_outbox
    set evidence_hash='hash_A', successor_evidence_hash='hash_B', successor_tier=3,
        successor_lock_bps=5000, successor_cliff_ts=1893456000, successor_policy_version=1,
        successor_schema_version=1, successor_operation='reissue'
    where id=v_job;

  -- Same-hash re-enqueue on the pending row: must clear the parked successor.
  perform public.enqueue_attestation_job(v_tok,'devnet','MintSAME','issue',1,6500,1893456000,1,1,'hash_A');
  select evidence_hash, successor_evidence_hash into v_desired, v_succ
    from public.attestation_outbox where id=v_job;
  assert v_succ is null, format('5-uncond: stale successor %s survived a same-hash pending re-enqueue', v_succ);
end $$;

-- Item 5 (operation in equality): a close with the SAME hash as the in-flight
-- issue must NOT be discarded as "returned to in-flight"; it differs by operation
-- and must be parked as the successor.
do $$
declare v_tok uuid; v_job uuid; v_lease uuid; v_succ text; v_succ_op text;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  v_job := public.enqueue_attestation_job(v_tok,'devnet','MintOP','issue',1,6500,1893456000,1,1,'hash_shared');
  select (job).lease_token into v_lease from public.claim_attestation_job(120);
  perform public.mark_attestation_broadcast(v_job, v_lease, 'sig_op', null, 120);

  -- Same hash, different operation (close): must park, not be dropped.
  perform public.enqueue_attestation_job(v_tok,'devnet','MintOP','close',1,6500,1893456000,1,1,'hash_shared');
  select successor_evidence_hash, successor_operation into v_succ, v_succ_op
    from public.attestation_outbox where id=v_job;
  assert v_succ = 'hash_shared', format('5-op: same-hash close not parked (successor=%s)', v_succ);
  assert v_succ_op = 'close', format('5-op: parked successor operation was %s, not close', v_succ_op);
end $$;

-- Item 10 (retry loop, no dropped enqueue): when the INSERT loses to a concurrent
-- winner that then COMPLETES before the follow-up SELECT, the function must not
-- raise. It loops and inserts a fresh job. Here we simulate by leaving no open row:
-- the enqueue must succeed by inserting, never raise "open job vanished".
do $$
declare v_tok uuid; v_id uuid; v_open integer;
begin
  truncate public.attestation_outbox;
  insert into public.tokens default values returning id into v_tok;
  -- A prior job that already COMPLETED (status 'done'): it is NOT open, so the
  -- partial unique index does not block a fresh insert. The enqueue must open a new
  -- job rather than raise.
  insert into public.attestation_outbox
    (token_id,cluster,mint,operation,desired_tier,desired_lock_bps,desired_cliff_ts,desired_policy_version,desired_schema_version,evidence_hash,status)
    values (v_tok,'devnet','MintRETRY','issue',1,6500,1893456000,1,1,'h_done','done');
  v_id := public.enqueue_attestation_job(v_tok,'devnet','MintRETRY','issue',1,6500,1893456000,1,1,'h_new');
  assert v_id is not null, '10-loop: enqueue returned null instead of opening a job';
  select count(*) into v_open from public.attestation_outbox
    where token_id=v_tok and status in ('pending','leased','broadcast');
  assert v_open = 1, format('10-loop: expected exactly one open job, found %s', v_open);
  assert exists (select 1 from public.attestation_outbox where id=v_id and evidence_hash='h_new'),
    '10-loop: opened job does not carry the new evidence';
end $$;

rollback;
