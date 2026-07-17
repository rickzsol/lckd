begin;

alter table public.launch_intents
  add column if not exists planned_lock_amount text,
  add column if not exists planned_unlock_timestamp bigint,
  add column if not exists planned_streamflow_fee_percent double precision,
  add column if not exists issued_atomic_transaction text;

alter table public.launch_alt_resources
  add column if not exists issued_setup_recent_slot bigint,
  add column if not exists issued_setup_transaction text;

alter table public.launch_intents
  add constraint launch_intents_planned_lock_amount_check check (
    planned_lock_amount is null or (
      planned_lock_amount ~ '^[0-9]+$' and planned_lock_amount::numeric > 0
    )
  ),
  add constraint launch_intents_planned_unlock_timestamp_check check (
    planned_unlock_timestamp is null or planned_unlock_timestamp > 0
  ),
  add constraint launch_intents_planned_streamflow_fee_percent_check check (
    planned_streamflow_fee_percent is null or (
      planned_streamflow_fee_percent >= 0 and
      planned_streamflow_fee_percent < 100
    )
  ),
  add constraint launch_intents_issued_atomic_transaction_check check (
    issued_atomic_transaction is null or (
      pg_catalog.length(issued_atomic_transaction) between 100 and 2000 and
      issued_atomic_transaction ~ '^[A-Za-z0-9+/]+={0,2}$'
    )
  );

alter table public.launch_alt_resources
  add constraint launch_alt_resources_issued_setup_recent_slot_check check (
    issued_setup_recent_slot is null or issued_setup_recent_slot > 0
  ),
  add constraint launch_alt_resources_issued_setup_transaction_check check (
    issued_setup_transaction is null or (
      pg_catalog.length(issued_setup_transaction) between 100 and 2000 and
      issued_setup_transaction ~ '^[A-Za-z0-9+/]+={0,2}$'
    )
  );

create or replace function public.guard_atomic_launch_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.launch_mode = 'atomic' then
      raise exception 'Atomic launch bindings cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.launch_mode is distinct from old.launch_mode then
    raise exception 'Launch mode is immutable' using errcode = '23514';
  end if;
  if old.launch_mode = 'atomic' and (
    new.github_id is distinct from old.github_id or
    new.creator_wallet is distinct from old.creator_wallet or
    new.mint_address is distinct from old.mint_address or
    new.metadata_uri is distinct from old.metadata_uri or
    new.image_uri is distinct from old.image_uri or
    new.config is distinct from old.config or
    new.config_hash is distinct from old.config_hash or
    new.metadata is distinct from old.metadata or
    new.metadata_hash is distinct from old.metadata_hash or
    new.metadata_address is distinct from old.metadata_address or
    new.alt_address is distinct from old.alt_address or
    new.alt_addresses is distinct from old.alt_addresses or
    new.alt_addresses_hash is distinct from old.alt_addresses_hash or
    new.quoted_token_amount is distinct from old.quoted_token_amount or
    new.max_quote_amount is distinct from old.max_quote_amount or
    new.planned_lock_amount is distinct from old.planned_lock_amount or
    new.planned_unlock_timestamp is distinct from old.planned_unlock_timestamp or
    new.planned_streamflow_fee_percent is distinct from old.planned_streamflow_fee_percent
  ) then
    raise exception 'Atomic launch bindings are immutable' using errcode = '23514';
  end if;
  if old.launch_mode = 'atomic' and
     old.issued_atomic_message_hash is not null and (
       new.issued_atomic_message_hash is distinct from old.issued_atomic_message_hash or
       new.issued_atomic_blockhash is distinct from old.issued_atomic_blockhash or
       new.issued_atomic_last_valid_block_height is distinct from old.issued_atomic_last_valid_block_height or
       new.issued_lock_amount is distinct from old.issued_lock_amount or
       new.issued_unlock_timestamp is distinct from old.issued_unlock_timestamp or
       new.issued_atomic_transaction is distinct from old.issued_atomic_transaction
     ) then
    raise exception 'Atomic transaction issuance is immutable' using errcode = '23514';
  end if;
  if old.launch_mode = 'atomic' and current_user = 'service_role' and (
    new.status is distinct from old.status or
    new.state_version is distinct from old.state_version or
    new.atomic_tx is distinct from old.atomic_tx or
    new.atomic_blockhash is distinct from old.atomic_blockhash or
    new.atomic_last_valid_block_height is distinct from old.atomic_last_valid_block_height or
    new.lock_metadata_id is distinct from old.lock_metadata_id or
    new.lock_amount is distinct from old.lock_amount or
    new.unlock_timestamp is distinct from old.unlock_timestamp
  ) then
    raise exception 'Atomic launch state is RPC-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_launch_alt_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intent_id is distinct from old.intent_id or
     new.alt_address is distinct from old.alt_address or
     new.ordered_addresses is distinct from old.ordered_addresses or
     new.addresses_hash is distinct from old.addresses_hash or
     new.issued_setup_message_hash is distinct from old.issued_setup_message_hash or
     new.issued_setup_blockhash is distinct from old.issued_setup_blockhash or
     new.issued_setup_last_valid_block_height is distinct from old.issued_setup_last_valid_block_height or
     new.issued_setup_recent_slot is distinct from old.issued_setup_recent_slot or
     new.issued_setup_transaction is distinct from old.issued_setup_transaction then
    raise exception 'ALT bindings are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.atomic_prepare_launch_intent_v2(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_metadata_uri text,
  p_image_uri text,
  p_config jsonb,
  p_config_hash text,
  p_metadata jsonb,
  p_metadata_hash text,
  p_metadata_address text,
  p_alt_address text,
  p_alt_addresses text[],
  p_alt_addresses_hash text,
  p_quoted_token_amount text,
  p_max_quote_amount text,
  p_planned_lock_amount text,
  p_planned_unlock_timestamp bigint,
  p_planned_streamflow_fee_percent double precision,
  p_issued_setup_message_hash text,
  p_issued_setup_blockhash text,
  p_issued_setup_last_valid_block_height bigint,
  p_issued_setup_recent_slot bigint,
  p_issued_setup_transaction text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
  v_alt public.launch_alt_resources%rowtype;
  v_distinct_addresses integer;
begin
  if p_github_id is null or p_creator_wallet is null or p_mint_address is null or
     p_metadata_uri is null or p_image_uri is null or p_config is null or
     p_config_hash is null or p_metadata is null or p_metadata_hash is null or
     p_metadata_address is null or p_alt_address is null or p_alt_addresses is null or
     p_alt_addresses_hash is null or p_quoted_token_amount is null or
     p_max_quote_amount is null or p_planned_lock_amount is null or
     p_planned_unlock_timestamp is null or p_planned_streamflow_fee_percent is null or
     p_issued_setup_message_hash is null or p_issued_setup_blockhash is null or
     p_issued_setup_last_valid_block_height is null or p_issued_setup_recent_slot is null or
     p_issued_setup_transaction is null or p_expires_at is null then
    raise exception 'Atomic launch binding is incomplete' using errcode = '22023';
  end if;

  select pg_catalog.count(distinct address)::integer into v_distinct_addresses
  from pg_catalog.unnest(p_alt_addresses) as address;

  if pg_catalog.btrim(p_github_id) = '' or
     pg_catalog.btrim(p_creator_wallet) = '' or
     pg_catalog.btrim(p_mint_address) = '' or
     pg_catalog.jsonb_typeof(p_config) <> 'object' or
     pg_catalog.jsonb_typeof(p_metadata) <> 'object' or
     p_config_hash !~ '^[0-9a-f]{64}$' or
     p_metadata_hash !~ '^[0-9a-f]{64}$' or
     p_alt_addresses_hash !~ '^[0-9a-f]{64}$' or
     p_quoted_token_amount !~ '^[0-9]+$' or p_quoted_token_amount::numeric <= 0 or
     p_max_quote_amount !~ '^[0-9]+$' or p_max_quote_amount::numeric <= 0 or
     p_planned_lock_amount !~ '^[0-9]+$' or p_planned_lock_amount::numeric <= 0 or
     p_planned_unlock_timestamp <= 0 or
     p_planned_streamflow_fee_percent < 0 or p_planned_streamflow_fee_percent >= 100 or
     p_issued_setup_message_hash !~ '^[0-9a-f]{64}$' or
     pg_catalog.btrim(p_issued_setup_blockhash) = '' or
     p_issued_setup_last_valid_block_height <= 0 or p_issued_setup_recent_slot <= 0 or
     pg_catalog.length(p_issued_setup_transaction) not between 100 and 2000 or
     p_issued_setup_transaction !~ '^[A-Za-z0-9+/]+={0,2}$' or
     pg_catalog.cardinality(p_alt_addresses) not between 1 and 256 or
     v_distinct_addresses <> pg_catalog.cardinality(p_alt_addresses) or
     pg_catalog.array_position(p_alt_addresses, null) is not null or
     p_metadata->>'metadataUri' is distinct from p_metadata_uri or
     p_metadata->>'imageUri' is distinct from p_image_uri or
     p_config->>'name' is distinct from p_metadata->>'name' or
     p_config->>'ticker' is distinct from p_metadata->>'ticker' or
     p_config->>'description' is distinct from p_metadata->>'description' or
     p_config->>'twitterUrl' is distinct from p_metadata->>'twitterUrl' or
     p_config->>'telegramUrl' is distinct from p_metadata->>'telegramUrl' or
     p_config->>'websiteUrl' is distinct from p_metadata->>'websiteUrl' or
     p_expires_at <= pg_catalog.clock_timestamp() or
     p_expires_at > pg_catalog.clock_timestamp() + interval '30 days' then
    raise exception 'Invalid atomic launch binding' using errcode = '22023';
  end if;

  select * into v_intent
  from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and status not in ('completed', 'abandoned')
  for update;

  if found then
    select * into v_alt
    from public.launch_alt_resources
    where intent_id = v_intent.id
    for update;
    if not found then
      raise exception 'ALT recovery state not found' using errcode = '55000';
    end if;
    if v_intent.launch_mode = 'atomic' and
       v_intent.mint_address = p_mint_address and
       v_intent.metadata_uri = p_metadata_uri and
       v_intent.image_uri = p_image_uri and
       v_intent.config = p_config and v_intent.config_hash = p_config_hash and
       v_intent.metadata = p_metadata and v_intent.metadata_hash = p_metadata_hash and
       v_intent.metadata_address = p_metadata_address then
      if v_intent.planned_lock_amount is null or
         v_intent.planned_unlock_timestamp is null or
         v_intent.planned_streamflow_fee_percent is null or
         v_alt.issued_setup_recent_slot is null or
         v_alt.issued_setup_transaction is null then
        raise exception 'Existing atomic launch lacks deterministic issuance' using errcode = '55000';
      end if;
      return public.atomic_launch_state_result(v_intent.id, true, false);
    end if;
    raise exception 'Another launch is active for this owner' using errcode = '23505';
  end if;

  insert into public.launch_intents (
    github_id, creator_wallet, mint_address, metadata_uri, image_uri,
    config, config_hash, metadata, metadata_hash, metadata_address,
    alt_address, alt_addresses, alt_addresses_hash,
    quoted_token_amount, max_quote_amount, planned_lock_amount,
    planned_unlock_timestamp, planned_streamflow_fee_percent,
    launch_mode, status, state_version, expires_at
  ) values (
    p_github_id, p_creator_wallet, p_mint_address, p_metadata_uri, p_image_uri,
    p_config, p_config_hash, p_metadata, p_metadata_hash, p_metadata_address,
    p_alt_address, p_alt_addresses, p_alt_addresses_hash,
    p_quoted_token_amount, p_max_quote_amount, p_planned_lock_amount,
    p_planned_unlock_timestamp, p_planned_streamflow_fee_percent,
    'atomic', 'prepared', 0, p_expires_at
  ) returning * into v_intent;

  insert into public.launch_alt_resources (
    intent_id, alt_address, ordered_addresses, addresses_hash,
    issued_setup_message_hash, issued_setup_blockhash,
    issued_setup_last_valid_block_height, issued_setup_recent_slot,
    issued_setup_transaction
  ) values (
    v_intent.id, p_alt_address, p_alt_addresses, p_alt_addresses_hash,
    p_issued_setup_message_hash, p_issued_setup_blockhash,
    p_issued_setup_last_valid_block_height, p_issued_setup_recent_slot,
    p_issued_setup_transaction
  );

  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_issue_transaction_v2(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_quoted_token_amount text,
  p_max_quote_amount text,
  p_message_hash text,
  p_blockhash text,
  p_last_valid_block_height bigint,
  p_lock_amount text,
  p_unlock_timestamp bigint,
  p_issued_atomic_transaction text
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
  if p_github_id is null or p_creator_wallet is null or p_mint_address is null or
     p_expected_state_version is null or p_quoted_token_amount is null or
     p_max_quote_amount is null or p_message_hash is null or p_blockhash is null or
     p_last_valid_block_height is null or p_lock_amount is null or
     p_unlock_timestamp is null or p_issued_atomic_transaction is null or
     p_message_hash !~ '^[0-9a-f]{64}$' or pg_catalog.btrim(p_blockhash) = '' or
     p_last_valid_block_height <= 0 or p_lock_amount !~ '^[0-9]+$' or
     p_lock_amount::numeric <= 0 or p_unlock_timestamp <= 0 or
     pg_catalog.length(p_issued_atomic_transaction) not between 100 and 2000 or
     p_issued_atomic_transaction !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Invalid atomic transaction issuance' using errcode = '22023';
  end if;

  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then
    raise exception 'Atomic launch not found' using errcode = '55000';
  end if;

  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id
  for update;
  if not found then
    raise exception 'ALT recovery state not found' using errcode = '55000';
  end if;

  if v_intent.planned_lock_amount is null or
     v_intent.planned_unlock_timestamp is null or
     v_intent.planned_streamflow_fee_percent is null or
     v_alt.issued_setup_recent_slot is null or
     v_alt.issued_setup_transaction is null then
    raise exception 'Atomic launch lacks deterministic issuance' using errcode = '55000';
  end if;

  if v_intent.quoted_token_amount <> p_quoted_token_amount or
     v_intent.max_quote_amount <> p_max_quote_amount or
     v_intent.planned_lock_amount <> p_lock_amount or
     v_intent.planned_unlock_timestamp <> p_unlock_timestamp then
    raise exception 'Atomic quote or lock plan changed after review' using errcode = '23514';
  end if;

  if v_intent.issued_atomic_message_hash is not null then
    if v_intent.issued_atomic_blockhash is null or
       v_intent.issued_atomic_last_valid_block_height is null or
       v_intent.issued_lock_amount is null or
       v_intent.issued_unlock_timestamp is null or
       v_intent.issued_atomic_transaction is null then
      raise exception 'Atomic transaction issuance is incomplete' using errcode = '55000';
    end if;
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;

  if v_intent.status <> 'alt_ready' or v_alt.status <> 'ready' or
     v_intent.state_version <> p_expected_state_version then
    raise exception 'Atomic transaction issuance is out of order' using errcode = '40001';
  end if;

  update public.launch_intents set
    issued_atomic_message_hash = p_message_hash,
    issued_atomic_blockhash = p_blockhash,
    issued_atomic_last_valid_block_height = p_last_valid_block_height,
    issued_lock_amount = p_lock_amount,
    issued_unlock_timestamp = p_unlock_timestamp,
    issued_atomic_transaction = p_issued_atomic_transaction,
    state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;

  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.get_owned_atomic_launch_intent(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text default null
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select pg_catalog.jsonb_build_object(
    'intentId', intent.id,
    'githubId', intent.github_id,
    'creatorWallet', intent.creator_wallet,
    'mintAddress', intent.mint_address,
    'status', intent.status,
    'stateVersion', intent.state_version,
    'config', intent.config,
    'configHash', intent.config_hash,
    'metadata', intent.metadata,
    'metadataHash', intent.metadata_hash,
    'metadataAddress', intent.metadata_address,
    'metadataUri', intent.metadata_uri,
    'imageUri', intent.image_uri,
    'altAddress', intent.alt_address,
    'altAddresses', intent.alt_addresses,
    'altAddressesHash', intent.alt_addresses_hash,
    'quotedTokenAmount', intent.quoted_token_amount,
    'maxQuoteAmount', intent.max_quote_amount,
    'plannedLockAmount', intent.planned_lock_amount,
    'plannedUnlockTimestamp', intent.planned_unlock_timestamp,
    'plannedStreamflowFeePercent', intent.planned_streamflow_fee_percent,
    'issuedAtomicMessageHash', intent.issued_atomic_message_hash,
    'issuedAtomicBlockhash', intent.issued_atomic_blockhash,
    'issuedAtomicLastValidBlockHeight', intent.issued_atomic_last_valid_block_height,
    'issuedLockAmount', intent.issued_lock_amount,
    'issuedUnlockTimestamp', intent.issued_unlock_timestamp,
    'issuedAtomicTransaction', intent.issued_atomic_transaction
  ) || pg_catalog.jsonb_build_object(
    'atomicTx', intent.atomic_tx,
    'atomicBlockhash', intent.atomic_blockhash,
    'atomicLastValidBlockHeight', intent.atomic_last_valid_block_height,
    'lockMetadataId', intent.lock_metadata_id,
    'lockAmount', intent.lock_amount,
    'unlockTimestamp', intent.unlock_timestamp,
    'expiresAt', intent.expires_at,
    'altStatus', alt.status,
    'altStateVersion', alt.state_version,
    'setupTx', alt.setup_tx,
    'setupBlockhash', alt.setup_blockhash,
    'setupLastValidBlockHeight', alt.setup_last_valid_block_height,
    'issuedSetupMessageHash', alt.issued_setup_message_hash,
    'issuedSetupBlockhash', alt.issued_setup_blockhash,
    'issuedSetupLastValidBlockHeight', alt.issued_setup_last_valid_block_height,
    'issuedSetupRecentSlot', alt.issued_setup_recent_slot,
    'issuedSetupTransaction', alt.issued_setup_transaction,
    'issuedCleanupPhase', alt.issued_cleanup_phase,
    'issuedCleanupMessageHash', alt.issued_cleanup_message_hash,
    'issuedCleanupBlockhash', alt.issued_cleanup_blockhash,
    'issuedCleanupLastValidBlockHeight', alt.issued_cleanup_last_valid_block_height,
    'altDeactivationTx', alt.deactivation_tx,
    'altDeactivationBlockhash', alt.deactivation_blockhash,
    'altDeactivationLastValidBlockHeight', alt.deactivation_last_valid_block_height,
    'altCloseTx', alt.close_tx,
    'altCloseBlockhash', alt.close_blockhash,
    'altCloseLastValidBlockHeight', alt.close_last_valid_block_height,
    'altSetupExpired', alt.setup_expired
  )
  from public.launch_intents as intent
  join public.launch_alt_resources as alt on alt.intent_id = intent.id
  where intent.github_id = p_github_id
    and intent.creator_wallet = p_creator_wallet
    and intent.launch_mode = 'atomic'
    and (
      p_mint_address is not null or
      intent.status not in ('completed', 'abandoned') or
      (intent.status = 'completed' and alt.status <> 'closed')
    )
    and (p_mint_address is null or intent.mint_address = p_mint_address)
  order by intent.updated_at desc
  limit 1
$$;

revoke execute on function public.atomic_prepare_launch_intent(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, text[], text,
  text, text, text, text, bigint, timestamptz
) from service_role;
revoke execute on function public.atomic_issue_transaction(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint
) from service_role;

revoke all on function public.atomic_prepare_launch_intent_v2(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, text[], text,
  text, text, text, bigint, double precision, text, text, bigint, bigint, text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.atomic_issue_transaction_v2(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.get_owned_atomic_launch_intent(text, text, text)
  from public, anon, authenticated;

grant execute on function public.atomic_prepare_launch_intent_v2(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, text[], text,
  text, text, text, bigint, double precision, text, text, bigint, bigint, text,
  timestamptz
) to service_role;
grant execute on function public.atomic_issue_transaction_v2(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint, text
) to service_role;
grant execute on function public.get_owned_atomic_launch_intent(text, text, text)
  to service_role;

commit;
