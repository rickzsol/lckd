-- Cleanup cannot invalidate an issued transaction until its finalized block
-- height has strictly passed. Route-side RPC checks additionally require the
-- blockhash to be invalid and reconcile exact finalized issued messages.
begin;

create or replace function public.atomic_request_cleanup(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_finalized_block_height bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
  v_alt public.launch_alt_resources%rowtype;
begin
  if p_finalized_block_height < 0 then
    raise exception 'Invalid finalized block height' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_intent.status in ('cleanup_required', 'abandoned') then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version then
    raise exception 'Stale atomic launch state' using errcode = '40001';
  end if;

  if v_intent.status = 'prepared' and v_alt.status = 'planned' and
     p_finalized_block_height > v_alt.issued_setup_last_valid_block_height then
    update public.launch_alt_resources set status = 'closed', setup_expired = true,
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_alt.id;
    update public.launch_intents set status = 'abandoned',
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_intent.id;
  elsif v_intent.status = 'alt_setup_submitted' and
        v_alt.status = 'setup_submitted' and
        p_finalized_block_height > v_alt.setup_last_valid_block_height then
    update public.launch_alt_resources set status = 'closed', setup_expired = true,
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_alt.id;
    update public.launch_intents set status = 'abandoned',
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_intent.id;
  elsif v_intent.status = 'alt_ready' and v_alt.status = 'ready' and
        (v_intent.issued_atomic_message_hash is null or
         p_finalized_block_height > v_intent.issued_atomic_last_valid_block_height) then
    update public.launch_intents set status = 'cleanup_required',
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_intent.id;
  elsif v_intent.status = 'atomic_submitted' and v_alt.status = 'ready' and
        p_finalized_block_height > v_intent.atomic_last_valid_block_height then
    update public.launch_intents set status = 'cleanup_required',
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_intent.id;
  else
    raise exception 'Atomic cleanup is unsafe or out of order' using errcode = '55000';
  end if;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

drop function if exists public.atomic_issue_alt_cleanup(
  text, text, text, bigint, bigint, text, text, text, bigint
);

create function public.atomic_issue_alt_cleanup(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_expected_alt_state_version bigint,
  p_phase text,
  p_message_hash text,
  p_blockhash text,
  p_last_valid_block_height bigint,
  p_finalized_block_height bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
  v_alt public.launch_alt_resources%rowtype;
  v_is_phase_switch boolean;
begin
  if p_phase not in ('deactivate', 'close') or p_message_hash !~ '^[0-9a-f]{64}$' or
     pg_catalog.btrim(p_blockhash) = '' or p_last_valid_block_height <= 0 or
     p_finalized_block_height < 0 then
    raise exception 'Invalid ALT cleanup issuance' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;
  if v_intent.state_version <> p_expected_state_version or
     v_alt.state_version <> p_expected_alt_state_version or
     (p_phase = 'deactivate' and (v_intent.status <> 'cleanup_required' or
       v_alt.status not in ('ready', 'deactivating'))) or
     (p_phase = 'close' and v_alt.status not in ('deactivating', 'close_submitted')) then
    raise exception 'ALT cleanup issuance is out of order' using errcode = '40001';
  end if;
  if v_alt.issued_cleanup_message_hash = p_message_hash and
     v_alt.issued_cleanup_phase = p_phase and
     v_alt.issued_cleanup_blockhash = p_blockhash and
     v_alt.issued_cleanup_last_valid_block_height = p_last_valid_block_height then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;

  v_is_phase_switch := v_alt.issued_cleanup_phase = 'deactivate' and
    p_phase = 'close' and v_alt.status in ('deactivating', 'close_submitted') and
    v_alt.deactivation_tx is not null;
  if v_alt.issued_cleanup_message_hash is not null and not v_is_phase_switch and
     p_finalized_block_height <= v_alt.issued_cleanup_last_valid_block_height then
    raise exception 'Existing ALT cleanup issuance has not expired' using errcode = '55000';
  end if;
  if v_alt.issued_cleanup_phase = 'close' and p_phase = 'deactivate' then
    raise exception 'ALT cleanup phase cannot move backwards' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    issued_cleanup_phase = p_phase,
    issued_cleanup_message_hash = p_message_hash,
    issued_cleanup_blockhash = p_blockhash,
    issued_cleanup_last_valid_block_height = p_last_valid_block_height,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

revoke all on function public.atomic_request_cleanup(text, text, text, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.atomic_issue_alt_cleanup(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.atomic_request_cleanup(text, text, text, bigint, bigint)
  to service_role;
grant execute on function public.atomic_issue_alt_cleanup(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) to service_role;

commit;
