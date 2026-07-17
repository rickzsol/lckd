begin;

alter table public.launch_intents
  add column if not exists launch_mode text not null default 'legacy',
  add column if not exists state_version bigint not null default 0,
  add column if not exists config_hash text,
  add column if not exists metadata jsonb,
  add column if not exists metadata_hash text,
  add column if not exists metadata_address text,
  add column if not exists alt_address text,
  add column if not exists alt_addresses text[],
  add column if not exists alt_addresses_hash text,
  add column if not exists quoted_token_amount text,
  add column if not exists max_quote_amount text,
  add column if not exists issued_atomic_message_hash text,
  add column if not exists issued_atomic_blockhash text,
  add column if not exists issued_atomic_last_valid_block_height bigint,
  add column if not exists issued_lock_amount text,
  add column if not exists issued_unlock_timestamp bigint,
  add column if not exists atomic_tx text,
  add column if not exists atomic_blockhash text,
  add column if not exists atomic_last_valid_block_height bigint;

-- Atomic launch is the only production write path. Preserve completed legacy
-- history, but make every unfinished legacy intent terminal before tightening
-- the constraint and revoking its mutation functions below.
update public.launch_intents
set status = 'abandoned', updated_at = pg_catalog.clock_timestamp()
where launch_mode = 'legacy' and status not in ('completed', 'abandoned');

alter table public.launch_intents
  drop constraint if exists launch_intents_status_check,
  drop constraint if exists launch_intents_check,
  drop constraint if exists launch_intents_check1;

alter table public.launch_intents
  add constraint launch_intents_mode_check check (launch_mode in ('legacy', 'atomic')) not valid,
  add constraint launch_intents_status_v2_check check (
    (launch_mode = 'legacy' and status in ('completed', 'abandoned')) or
    (launch_mode = 'atomic' and status in (
      'prepared', 'alt_setup_submitted', 'alt_ready', 'atomic_submitted',
      'completed', 'cleanup_required', 'abandoned'
    ))
  ) not valid,
  add constraint launch_intents_atomic_binding_check check (
    launch_mode <> 'atomic' or (
      config_hash ~ '^[0-9a-f]{64}$' and
      metadata is not null and jsonb_typeof(metadata) = 'object' and
      metadata_hash ~ '^[0-9a-f]{64}$' and
      metadata_address is not null and
      alt_address is not null and
      cardinality(alt_addresses) between 1 and 256 and
      alt_addresses_hash ~ '^[0-9a-f]{64}$'
      and quoted_token_amount ~ '^[0-9]+$' and quoted_token_amount::numeric > 0
      and max_quote_amount ~ '^[0-9]+$' and max_quote_amount::numeric > 0
    )
  ) not valid,
  add constraint launch_intents_atomic_receipt_check check (
    launch_mode <> 'atomic' or
    status not in ('atomic_submitted', 'completed') or (
      atomic_tx is not null and
      atomic_blockhash is not null and
      atomic_last_valid_block_height is not null and
      lock_metadata_id is not null and
      lock_amount is not null and
      unlock_timestamp is not null
    )
  ) not valid,
  add constraint launch_intents_legacy_receipt_check check (
    launch_mode <> 'legacy' or status in ('prepared', 'abandoned') or (
      create_tx is not null and create_blockhash is not null and
      create_last_valid_block_height is not null
    )
  ) not valid,
  add constraint launch_intents_legacy_lock_check check (
    launch_mode <> 'legacy' or lock_tx is not null or
    status not in ('lock_submitted', 'completed')
  ) not valid;

create table public.launch_alt_resources (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique references public.launch_intents(id) on delete restrict,
  alt_address text not null unique,
  ordered_addresses text[] not null,
  addresses_hash text not null check (addresses_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'planned' check (status in (
    'planned', 'setup_submitted', 'ready', 'deactivating',
    'close_submitted', 'closed'
  )),
  setup_tx text,
  setup_blockhash text,
  setup_last_valid_block_height bigint,
  issued_setup_message_hash text not null check (issued_setup_message_hash ~ '^[0-9a-f]{64}$'),
  issued_setup_blockhash text not null,
  issued_setup_last_valid_block_height bigint not null check (issued_setup_last_valid_block_height > 0),
  issued_cleanup_phase text check (issued_cleanup_phase in ('deactivate', 'close')),
  issued_cleanup_message_hash text check (issued_cleanup_message_hash ~ '^[0-9a-f]{64}$'),
  issued_cleanup_blockhash text,
  issued_cleanup_last_valid_block_height bigint check (issued_cleanup_last_valid_block_height > 0),
  deactivation_tx text,
  deactivation_blockhash text,
  deactivation_last_valid_block_height bigint,
  close_tx text,
  close_blockhash text,
  close_last_valid_block_height bigint,
  setup_expired boolean not null default false,
  state_version bigint not null default 0 check (state_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(ordered_addresses) between 1 and 256),
  check (status = 'planned' or (status = 'closed' and setup_expired) or (
    setup_tx is not null and setup_blockhash is not null and
    setup_last_valid_block_height is not null
  )),
  check (status not in ('deactivating', 'close_submitted', 'closed') or
    (status = 'closed' and setup_expired) or (
    deactivation_tx is not null and deactivation_blockhash is not null and
    deactivation_last_valid_block_height is not null
  )),
  check (status not in ('close_submitted', 'closed') or
    (status = 'closed' and setup_expired) or (
    close_tx is not null and close_blockhash is not null and
    close_last_valid_block_height is not null
  )),
  check (not setup_expired or status = 'closed')
);

create index launch_alt_resources_status_idx
  on public.launch_alt_resources (status, updated_at);
create unique index launch_intents_atomic_tx_unique
  on public.launch_intents (atomic_tx) where atomic_tx is not null;
create unique index launch_alt_resources_setup_tx_unique
  on public.launch_alt_resources (setup_tx) where setup_tx is not null;
create unique index launch_alt_resources_deactivation_tx_unique
  on public.launch_alt_resources (deactivation_tx) where deactivation_tx is not null;
create unique index launch_alt_resources_close_tx_unique
  on public.launch_alt_resources (close_tx) where close_tx is not null;
alter table public.launch_alt_resources enable row level security;
revoke all on table public.launch_alt_resources
  from public, anon, authenticated, service_role;

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
    new.alt_addresses_hash is distinct from old.alt_addresses_hash
    or new.quoted_token_amount is distinct from old.quoted_token_amount
    or new.max_quote_amount is distinct from old.max_quote_amount
  ) then
    raise exception 'Atomic launch bindings are immutable' using errcode = '23514';
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
     new.issued_setup_last_valid_block_height is distinct from old.issued_setup_last_valid_block_height then
    raise exception 'ALT bindings are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_atomic_launch_immutability on public.launch_intents;
create trigger guard_atomic_launch_immutability
before update or delete on public.launch_intents
for each row execute function public.guard_atomic_launch_immutability();
drop trigger if exists guard_launch_alt_immutability on public.launch_alt_resources;
create trigger guard_launch_alt_immutability
before update on public.launch_alt_resources
for each row execute function public.guard_launch_alt_immutability();

create or replace function public.atomic_launch_state_result(
  p_intent_id uuid,
  p_replayed boolean,
  p_updated boolean default false
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select pg_catalog.jsonb_build_object(
    'intentId', intent.id,
    'status', intent.status,
    'stateVersion', intent.state_version,
    'altStatus', alt.status,
    'altStateVersion', alt.state_version,
    'replayed', p_replayed,
    'updated', p_updated
  )
  from public.launch_intents as intent
  join public.launch_alt_resources as alt on alt.intent_id = intent.id
  where intent.id = p_intent_id
$$;

create or replace function public.atomic_prepare_launch_intent(
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
  p_issued_setup_message_hash text,
  p_issued_setup_blockhash text,
  p_issued_setup_last_valid_block_height bigint,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
  v_distinct_addresses integer;
begin
  if p_github_id is null or p_creator_wallet is null or p_mint_address is null or
     p_metadata_uri is null or p_image_uri is null or p_config is null or
     p_config_hash is null or p_metadata is null or p_metadata_hash is null or
     p_metadata_address is null or p_alt_address is null or p_alt_addresses is null or
     p_alt_addresses_hash is null or p_quoted_token_amount is null or
     p_max_quote_amount is null or p_issued_setup_message_hash is null or
     p_issued_setup_blockhash is null or p_issued_setup_last_valid_block_height is null or
     p_expires_at is null then
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
     p_issued_setup_message_hash !~ '^[0-9a-f]{64}$' or
     pg_catalog.btrim(p_issued_setup_blockhash) = '' or
     p_issued_setup_last_valid_block_height <= 0 or
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
    if v_intent.launch_mode = 'atomic' and
       v_intent.mint_address = p_mint_address and
       v_intent.metadata_uri = p_metadata_uri and
       v_intent.image_uri = p_image_uri and
       v_intent.config = p_config and v_intent.config_hash = p_config_hash and
       v_intent.metadata = p_metadata and v_intent.metadata_hash = p_metadata_hash and
       v_intent.metadata_address = p_metadata_address and
       v_intent.alt_address = p_alt_address and
       v_intent.alt_addresses = p_alt_addresses and
       v_intent.alt_addresses_hash = p_alt_addresses_hash and
       v_intent.quoted_token_amount = p_quoted_token_amount and
       v_intent.max_quote_amount = p_max_quote_amount then
      return public.atomic_launch_state_result(v_intent.id, true, false);
    end if;
    raise exception 'Another launch is active for this owner' using errcode = '23505';
  end if;

  insert into public.launch_intents (
    github_id, creator_wallet, mint_address, metadata_uri, image_uri,
    config, config_hash, metadata, metadata_hash, metadata_address,
    alt_address, alt_addresses,
    alt_addresses_hash, quoted_token_amount, max_quote_amount,
    launch_mode, status, state_version, expires_at
  ) values (
    p_github_id, p_creator_wallet, p_mint_address, p_metadata_uri, p_image_uri,
    p_config, p_config_hash, p_metadata, p_metadata_hash, p_metadata_address, p_alt_address,
    p_alt_addresses, p_alt_addresses_hash, p_quoted_token_amount, p_max_quote_amount,
    'atomic', 'prepared', 0, p_expires_at
  ) returning * into v_intent;

  insert into public.launch_alt_resources (
    intent_id, alt_address, ordered_addresses, addresses_hash,
    issued_setup_message_hash, issued_setup_blockhash, issued_setup_last_valid_block_height
  ) values (
    v_intent.id, p_alt_address, p_alt_addresses, p_alt_addresses_hash,
    p_issued_setup_message_hash, p_issued_setup_blockhash, p_issued_setup_last_valid_block_height
  );
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_issue_transaction(
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
  p_unlock_timestamp bigint
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
  if p_message_hash !~ '^[0-9a-f]{64}$' or pg_catalog.btrim(p_blockhash) = '' or
     p_last_valid_block_height <= 0 or p_lock_amount !~ '^[0-9]+$' or
     p_lock_amount::numeric <= 0 or p_unlock_timestamp <= 0 then
    raise exception 'Invalid atomic transaction issuance' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_intent.quoted_token_amount <> p_quoted_token_amount or
     v_intent.max_quote_amount <> p_max_quote_amount then
    raise exception 'Atomic quote changed after review' using errcode = '23514';
  end if;
  if v_intent.status <> 'alt_ready' or v_alt.status <> 'ready' or
     v_intent.state_version <> p_expected_state_version then
    raise exception 'Atomic transaction issuance is out of order' using errcode = '40001';
  end if;
  if v_intent.issued_atomic_message_hash is not null then
    if v_intent.issued_atomic_message_hash = p_message_hash and
       v_intent.issued_atomic_blockhash = p_blockhash and
       v_intent.issued_atomic_last_valid_block_height = p_last_valid_block_height and
       v_intent.issued_lock_amount = p_lock_amount and
       v_intent.issued_unlock_timestamp = p_unlock_timestamp then
      return public.atomic_launch_state_result(v_intent.id, true, false);
    end if;
    raise exception 'An atomic transaction is already issued' using errcode = '23514';
  end if;
  update public.launch_intents set
    issued_atomic_message_hash = p_message_hash,
    issued_atomic_blockhash = p_blockhash,
    issued_atomic_last_valid_block_height = p_last_valid_block_height,
    issued_lock_amount = p_lock_amount,
    issued_unlock_timestamp = p_unlock_timestamp,
    state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_checkpoint_alt_setup_submitted(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_previous_signature text,
  p_setup_signature text,
  p_setup_blockhash text,
  p_setup_last_valid_block_height bigint,
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
  if p_setup_signature is null or p_setup_blockhash is null or
     p_setup_last_valid_block_height <= 0 or p_finalized_block_height < 0 then
    raise exception 'Invalid ALT setup receipt' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if p_setup_blockhash <> v_alt.issued_setup_blockhash or
     p_setup_last_valid_block_height <> v_alt.issued_setup_last_valid_block_height then
    raise exception 'ALT setup receipt changed from issued transaction' using errcode = '23514';
  end if;

  if v_intent.status in (
       'alt_setup_submitted', 'alt_ready', 'atomic_submitted',
       'completed', 'cleanup_required'
     ) and
     v_alt.setup_tx = p_setup_signature and
     v_alt.setup_blockhash = p_setup_blockhash and
     v_alt.setup_last_valid_block_height = p_setup_last_valid_block_height then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version then
    raise exception 'Stale atomic launch state' using errcode = '40001';
  end if;
  if not (
    (v_intent.status = 'prepared' and v_alt.status = 'planned' and
     p_previous_signature is null) or
    (v_intent.status = 'alt_setup_submitted' and v_alt.status = 'setup_submitted' and
     p_previous_signature = v_alt.setup_tx and
     p_setup_signature <> v_alt.setup_tx and
     p_finalized_block_height > v_alt.setup_last_valid_block_height)
  ) then
    raise exception 'ALT setup checkpoint is out of order' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    status = 'setup_submitted', setup_tx = p_setup_signature,
    setup_blockhash = p_setup_blockhash,
    setup_last_valid_block_height = p_setup_last_valid_block_height,
    state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  update public.launch_intents set
    status = 'alt_setup_submitted', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_checkpoint_alt_ready(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_setup_signature text
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
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_intent.status in ('alt_ready', 'atomic_submitted', 'completed', 'cleanup_required') and
     v_alt.status in ('ready', 'deactivating', 'close_submitted', 'closed') and
     v_alt.setup_tx = p_setup_signature then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version then
    raise exception 'Stale atomic launch state' using errcode = '40001';
  end if;
  if v_intent.status <> 'alt_setup_submitted' or
     v_alt.status <> 'setup_submitted' or v_alt.setup_tx <> p_setup_signature then
    raise exception 'ALT ready checkpoint is out of order' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    status = 'ready', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  update public.launch_intents set
    status = 'alt_ready', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_checkpoint_atomic_submitted(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_previous_signature text,
  p_atomic_signature text,
  p_lock_metadata_id text,
  p_lock_amount text,
  p_unlock_timestamp bigint,
  p_atomic_blockhash text,
  p_atomic_last_valid_block_height bigint,
  p_finalized_block_height bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
begin
  if p_atomic_signature is null or p_lock_metadata_id is null or
     p_lock_amount !~ '^[0-9]+$' or p_lock_amount::numeric <= 0 or
     p_unlock_timestamp <= 0 or p_atomic_blockhash is null or
     p_atomic_last_valid_block_height <= 0 or p_finalized_block_height < 0 then
    raise exception 'Invalid atomic transaction receipt' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;

  if p_lock_metadata_id is distinct from v_intent.metadata_address then
    raise exception 'Atomic metadata signer changed' using errcode = '23514';
  end if;
  if v_intent.issued_atomic_message_hash is null or
     p_atomic_blockhash <> v_intent.issued_atomic_blockhash or
     p_atomic_last_valid_block_height <> v_intent.issued_atomic_last_valid_block_height or
     p_lock_amount <> v_intent.issued_lock_amount or
     p_unlock_timestamp <> v_intent.issued_unlock_timestamp then
    raise exception 'Atomic receipt changed from issued transaction' using errcode = '23514';
  end if;

  if v_intent.status in ('atomic_submitted', 'completed') and
     v_intent.atomic_tx = p_atomic_signature and
     v_intent.lock_metadata_id = p_lock_metadata_id and
     v_intent.lock_amount = p_lock_amount and
     v_intent.unlock_timestamp = p_unlock_timestamp and
     v_intent.atomic_blockhash = p_atomic_blockhash and
     v_intent.atomic_last_valid_block_height = p_atomic_last_valid_block_height then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version then
    raise exception 'Stale atomic launch state' using errcode = '40001';
  end if;
  if not (
    (v_intent.status = 'alt_ready' and p_previous_signature is null) or
    (v_intent.status = 'atomic_submitted' and
     p_previous_signature = v_intent.atomic_tx and
     p_atomic_signature <> v_intent.atomic_tx and
     p_finalized_block_height > v_intent.atomic_last_valid_block_height)
  ) then
    raise exception 'Atomic transaction checkpoint is out of order' using errcode = '55000';
  end if;

  update public.launch_intents set
    status = 'atomic_submitted', atomic_tx = p_atomic_signature,
    lock_metadata_id = p_lock_metadata_id, lock_amount = p_lock_amount,
    unlock_timestamp = p_unlock_timestamp, atomic_blockhash = p_atomic_blockhash,
    atomic_last_valid_block_height = p_atomic_last_valid_block_height,
    state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

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

  if v_intent.status = 'prepared' and v_alt.status = 'planned' then
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
  elsif v_intent.status = 'alt_ready' and v_alt.status = 'ready' then
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

create or replace function public.atomic_issue_alt_cleanup(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_expected_alt_state_version bigint,
  p_phase text,
  p_message_hash text,
  p_blockhash text,
  p_last_valid_block_height bigint
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
  if p_phase not in ('deactivate', 'close') or p_message_hash !~ '^[0-9a-f]{64}$' or
     pg_catalog.btrim(p_blockhash) = '' or p_last_valid_block_height <= 0 then
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

create or replace function public.atomic_checkpoint_alt_deactivating(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_expected_alt_state_version bigint,
  p_previous_signature text,
  p_deactivation_signature text,
  p_deactivation_blockhash text,
  p_deactivation_last_valid_block_height bigint,
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
  if p_deactivation_signature is null or p_deactivation_blockhash is null or
     p_deactivation_last_valid_block_height <= 0 or p_finalized_block_height < 0 then
    raise exception 'Invalid ALT deactivation receipt' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_alt.issued_cleanup_phase <> 'deactivate' or
     v_alt.issued_cleanup_blockhash <> p_deactivation_blockhash or
     v_alt.issued_cleanup_last_valid_block_height <> p_deactivation_last_valid_block_height then
    raise exception 'ALT deactivation changed from issued transaction' using errcode = '23514';
  end if;
  if v_alt.status in ('deactivating', 'close_submitted', 'closed') and
     not v_alt.setup_expired and
     v_alt.deactivation_tx = p_deactivation_signature and
     v_alt.deactivation_blockhash = p_deactivation_blockhash and
     v_alt.deactivation_last_valid_block_height = p_deactivation_last_valid_block_height then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version or
     v_alt.state_version <> p_expected_alt_state_version then
    raise exception 'Stale ALT cleanup state' using errcode = '40001';
  end if;
  if v_intent.status <> 'cleanup_required' or not (
    (v_alt.status = 'ready' and p_previous_signature is null) or
    (v_alt.status = 'deactivating' and
     p_previous_signature = v_alt.deactivation_tx and
     p_deactivation_signature <> v_alt.deactivation_tx and
     p_finalized_block_height > v_alt.deactivation_last_valid_block_height)
  ) then
    raise exception 'ALT deactivation checkpoint is out of order' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    status = 'deactivating', deactivation_tx = p_deactivation_signature,
    deactivation_blockhash = p_deactivation_blockhash,
    deactivation_last_valid_block_height = p_deactivation_last_valid_block_height,
    state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_checkpoint_alt_close_submitted(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_expected_alt_state_version bigint,
  p_previous_signature text,
  p_close_signature text,
  p_close_blockhash text,
  p_close_last_valid_block_height bigint,
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
  if p_close_signature is null or p_close_blockhash is null or
     p_close_last_valid_block_height <= 0 or p_finalized_block_height < 0 then
    raise exception 'Invalid ALT close receipt' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_alt.issued_cleanup_phase <> 'close' or
     v_alt.issued_cleanup_blockhash <> p_close_blockhash or
     v_alt.issued_cleanup_last_valid_block_height <> p_close_last_valid_block_height then
    raise exception 'ALT close changed from issued transaction' using errcode = '23514';
  end if;
  if v_alt.status in ('close_submitted', 'closed') and
     not v_alt.setup_expired and
     v_alt.close_tx = p_close_signature and
     v_alt.close_blockhash = p_close_blockhash and
     v_alt.close_last_valid_block_height = p_close_last_valid_block_height then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version or
     v_alt.state_version <> p_expected_alt_state_version then
    raise exception 'Stale ALT cleanup state' using errcode = '40001';
  end if;
  if v_intent.status not in ('completed', 'cleanup_required') or not (
    (v_alt.status = 'deactivating' and p_previous_signature is null) or
    (v_alt.status = 'close_submitted' and
     p_previous_signature = v_alt.close_tx and
     p_close_signature <> v_alt.close_tx and
     p_finalized_block_height > v_alt.close_last_valid_block_height)
  ) then
    raise exception 'ALT close checkpoint is out of order' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    status = 'close_submitted', close_tx = p_close_signature,
    close_blockhash = p_close_blockhash,
    close_last_valid_block_height = p_close_last_valid_block_height,
    state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.atomic_checkpoint_alt_closed(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_expected_state_version bigint,
  p_expected_alt_state_version bigint,
  p_close_signature text
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
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_alt.status = 'closed' and not v_alt.setup_expired and
     v_alt.close_tx = p_close_signature then
    return public.atomic_launch_state_result(v_intent.id, true, false);
  end if;
  if v_intent.state_version <> p_expected_state_version or
     v_alt.state_version <> p_expected_alt_state_version then
    raise exception 'Stale ALT cleanup state' using errcode = '40001';
  end if;
  if v_intent.status not in ('completed', 'cleanup_required') or
     v_alt.status <> 'close_submitted' or v_alt.close_tx <> p_close_signature then
    raise exception 'ALT close finalization is out of order' using errcode = '55000';
  end if;

  update public.launch_alt_resources set
    status = 'closed', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id;
  if v_intent.status = 'cleanup_required' then
    update public.launch_intents set
      status = 'abandoned', state_version = state_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_intent.id;
  end if;
  return public.atomic_launch_state_result(v_intent.id, false, false);
end;
$$;

create or replace function public.record_verified_atomic_launch(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_metadata_uri text,
  p_atomic_tx text,
  p_lock_metadata_id text,
  p_name text,
  p_ticker text,
  p_description text,
  p_image_uri text,
  p_lock_duration_days integer,
  p_lock_percentage numeric,
  p_lock_unlock_at timestamptz,
  p_lock_amount text,
  p_lock_debited_amount numeric,
  p_purchased_amount numeric,
  p_buy_amount_sol numeric,
  p_github_username text,
  p_github_repo text,
  p_live_url text,
  p_twitter_url text,
  p_telegram_url text,
  p_website_url text,
  p_verified_at timestamptz,
  p_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.launch_intents%rowtype;
  v_alt public.launch_alt_resources%rowtype;
  v_token_id uuid;
  v_was_existing boolean;
begin
  if p_atomic_tx is null or p_lock_metadata_id is null or
     p_lock_duration_days not between 7 and 365 or
     p_lock_percentage <= 0 or p_lock_percentage > 100 or
     p_lock_unlock_at is null or p_lock_amount !~ '^[0-9]+$' or
     p_lock_amount::numeric <= 0 or p_lock_debited_amount <= 0 or
     p_lock_debited_amount < p_lock_amount::numeric or
     p_lock_debited_amount > p_purchased_amount or
     p_purchased_amount <= 0 or p_buy_amount_sol <= 0 or p_verified_at is null then
    raise exception 'Invalid finalized atomic launch' using errcode = '22023';
  end if;
  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  if v_intent.status = 'completed' and v_intent.atomic_tx = p_atomic_tx and
     v_intent.metadata_address = p_lock_metadata_id and
     v_intent.lock_metadata_id = p_lock_metadata_id and exists (
       select 1 from public.tokens where mint_address = p_mint_address
         and creator_wallet = p_creator_wallet and launch_tx = p_atomic_tx
         and lock_tx = p_atomic_tx and name = p_name and ticker = p_ticker
         and description = p_description and image_uri = p_image_uri
         and lock_duration_days = p_lock_duration_days
         and lock_percentage = p_lock_percentage
         and lock_unlock_at = p_lock_unlock_at and lock_amount = p_lock_amount
         and buy_amount_sol = p_buy_amount_sol
         and github_username is not distinct from p_github_username
         and github_repo is not distinct from p_github_repo
         and live_url is not distinct from p_live_url
         and twitter_url is not distinct from p_twitter_url
         and telegram_url is not distinct from p_telegram_url
         and website_url is not distinct from p_website_url
     ) then
    return public.atomic_launch_state_result(v_intent.id, true, true);
  end if;
  if v_intent.state_version <> p_expected_state_version then
    raise exception 'Stale atomic launch state' using errcode = '40001';
  end if;
  if v_intent.status <> 'atomic_submitted' or v_alt.status <> 'ready' or
     v_intent.atomic_tx <> p_atomic_tx or
     v_intent.metadata_address <> p_lock_metadata_id or
     v_intent.lock_metadata_id <> p_lock_metadata_id or
     v_intent.metadata_uri <> p_metadata_uri or
     v_intent.image_uri <> p_image_uri or
     v_intent.lock_amount <> p_lock_amount or
     v_intent.unlock_timestamp <> extract(epoch from p_lock_unlock_at)::bigint then
    raise exception 'Atomic receipt does not match launch intent' using errcode = '23514';
  end if;
  if v_intent.metadata->>'metadataUri' is distinct from p_metadata_uri or
     v_intent.metadata->>'imageUri' is distinct from p_image_uri or
     v_intent.metadata->>'name' is distinct from p_name or
     v_intent.metadata->>'ticker' is distinct from p_ticker or
     v_intent.metadata->>'description' is distinct from p_description or
     v_intent.metadata->>'twitterUrl' is distinct from p_twitter_url or
     v_intent.metadata->>'telegramUrl' is distinct from p_telegram_url or
     v_intent.metadata->>'websiteUrl' is distinct from p_website_url then
    raise exception 'Finalized metadata changed' using errcode = '23514';
  end if;
  if v_intent.config->>'name' is distinct from p_name or
     v_intent.config->>'ticker' is distinct from p_ticker or
     v_intent.config->>'description' is distinct from p_description or
     v_intent.config->>'githubUsername' is distinct from p_github_username or
     v_intent.config->>'githubRepo' is distinct from p_github_repo or
     v_intent.config->>'liveUrl' is distinct from p_live_url or
     v_intent.config->>'twitterUrl' is distinct from p_twitter_url or
     v_intent.config->>'telegramUrl' is distinct from p_telegram_url or
     v_intent.config->>'websiteUrl' is distinct from p_website_url or
     (v_intent.config->>'lockDurationDays')::integer <> p_lock_duration_days or
     p_purchased_amount <> v_intent.quoted_token_amount::numeric or
     p_lock_amount::numeric + 10 <
       p_purchased_amount * (v_intent.config->>'lockPercentage')::numeric / 100 or
     pg_catalog.abs(
       p_lock_percentage -
       pg_catalog.floor(p_lock_amount::numeric * 1000000 / p_purchased_amount) / 10000
     ) > 0.0001 or
     p_buy_amount_sol * 1000000000 <
       pg_catalog.round((v_intent.config->>'buyAmountSol')::numeric * 1000000000) or
     p_buy_amount_sol * 1000000000 > v_intent.max_quote_amount::numeric then
    raise exception 'Finalized launch changed reviewed configuration' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.tokens where mint_address = p_mint_address
  ) into v_was_existing;
  insert into public.tokens as token (
    mint_address, name, ticker, description, image_uri, creator_wallet,
    lock_tx, lock_duration_days, lock_percentage, lock_unlock_at, lock_amount,
    buy_amount_sol, github_username, github_repo, live_url, trust_tier,
    launch_tx, twitter_url, telegram_url, website_url,
    launch_verified_at, lock_verified_at
  ) values (
    p_mint_address, p_name, p_ticker, p_description, p_image_uri, p_creator_wallet,
    p_atomic_tx, p_lock_duration_days, p_lock_percentage, p_lock_unlock_at, p_lock_amount,
    p_buy_amount_sol, p_github_username, p_github_repo, p_live_url, 1,
    p_atomic_tx, p_twitter_url, p_telegram_url, p_website_url,
    p_verified_at, p_verified_at
  )
  on conflict (mint_address) do update set
    name = excluded.name, ticker = excluded.ticker,
    description = excluded.description, image_uri = excluded.image_uri,
    lock_duration_days = excluded.lock_duration_days,
    lock_percentage = excluded.lock_percentage,
    lock_unlock_at = excluded.lock_unlock_at, lock_amount = excluded.lock_amount,
    buy_amount_sol = excluded.buy_amount_sol,
    github_username = excluded.github_username, github_repo = excluded.github_repo,
    live_url = excluded.live_url, twitter_url = excluded.twitter_url,
    telegram_url = excluded.telegram_url, website_url = excluded.website_url,
    launch_verified_at = excluded.launch_verified_at,
    lock_verified_at = excluded.lock_verified_at
  where token.creator_wallet = excluded.creator_wallet
    and token.launch_tx = excluded.launch_tx and token.lock_tx = excluded.lock_tx
  returning id into v_token_id;
  if v_token_id is null then
    raise exception 'Token ownership or receipt changed' using errcode = '23514';
  end if;

  -- The reviewed atomic transaction deactivates this exact ALT as its final
  -- instruction. Persist that finalized deactivation so the wallet only needs
  -- the later close transaction after the SlotHashes cooldown.
  update public.launch_alt_resources set
    status = 'deactivating',
    deactivation_tx = p_atomic_tx,
    deactivation_blockhash = v_intent.atomic_blockhash,
    deactivation_last_valid_block_height = v_intent.atomic_last_valid_block_height,
    state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_alt.id and status = 'ready';
  if not found then
    raise exception 'ALT deactivation state changed' using errcode = '40001';
  end if;

  update public.launch_intents set
    status = 'completed', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, v_was_existing);
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
    'issuedAtomicMessageHash', intent.issued_atomic_message_hash,
    'issuedAtomicBlockhash', intent.issued_atomic_blockhash,
    'issuedAtomicLastValidBlockHeight', intent.issued_atomic_last_valid_block_height,
    'issuedLockAmount', intent.issued_lock_amount,
    'issuedUnlockTimestamp', intent.issued_unlock_timestamp,
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

revoke all on function public.guard_atomic_launch_immutability()
  from public, anon, authenticated;
revoke all on function public.guard_launch_alt_immutability()
  from public, anon, authenticated;
revoke all on function public.atomic_launch_state_result(uuid, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.atomic_prepare_launch_intent(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, text[], text,
  text, text, text, text, bigint, timestamptz
) from public, anon, authenticated;
revoke all on function public.atomic_issue_transaction(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_alt_setup_submitted(
  text, text, text, bigint, text, text, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_alt_ready(
  text, text, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_atomic_submitted(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_request_cleanup(
  text, text, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_issue_alt_cleanup(
  text, text, text, bigint, bigint, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_alt_deactivating(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_alt_close_submitted(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.atomic_checkpoint_alt_closed(
  text, text, text, bigint, bigint, text
) from public, anon, authenticated;
revoke all on function public.record_verified_atomic_launch(
  text, text, text, text, text, text, text, text, text, text, integer, numeric,
  timestamptz, text, numeric, numeric, numeric, text, text, text, text, text,
  text, timestamptz, bigint
) from public, anon, authenticated;
revoke all on function public.get_owned_atomic_launch_intent(text, text, text)
  from public, anon, authenticated;

revoke all on table public.launch_intents from service_role;

revoke execute on function public.prepare_launch_intent(
  text, text, text, text, text, jsonb, timestamptz
) from service_role;
revoke execute on function public.checkpoint_create_submitted(
  text, text, text, text, text, bigint
) from service_role;
revoke execute on function public.checkpoint_create_finalized(
  text, text, text, text
) from service_role;
revoke execute on function public.checkpoint_lock_submitted(
  text, text, text, text, text, text, text, bigint, text, bigint
) from service_role;
revoke execute on function public.record_verified_launch(
  text, text, text, text, text, text, text, text, text, text, integer, numeric,
  timestamptz, text, numeric, numeric, numeric, text, text, text, text, text,
  text, timestamptz
) from service_role;

grant execute on function public.atomic_prepare_launch_intent(
  text, text, text, text, text, jsonb, text, jsonb, text, text, text, text[], text,
  text, text, text, text, bigint, timestamptz
) to service_role;
grant execute on function public.atomic_issue_transaction(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint
) to service_role;
grant execute on function public.atomic_checkpoint_alt_setup_submitted(
  text, text, text, bigint, text, text, text, bigint, bigint
) to service_role;
grant execute on function public.atomic_checkpoint_alt_ready(
  text, text, text, bigint, text
) to service_role;
grant execute on function public.atomic_checkpoint_atomic_submitted(
  text, text, text, bigint, text, text, text, text, bigint, text, bigint, bigint
) to service_role;
grant execute on function public.atomic_request_cleanup(
  text, text, text, bigint, bigint
) to service_role;
grant execute on function public.atomic_issue_alt_cleanup(
  text, text, text, bigint, bigint, text, text, text, bigint
) to service_role;
grant execute on function public.atomic_checkpoint_alt_deactivating(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) to service_role;
grant execute on function public.atomic_checkpoint_alt_close_submitted(
  text, text, text, bigint, bigint, text, text, text, bigint, bigint
) to service_role;
grant execute on function public.atomic_checkpoint_alt_closed(
  text, text, text, bigint, bigint, text
) to service_role;
grant execute on function public.record_verified_atomic_launch(
  text, text, text, text, text, text, text, text, text, text, integer, numeric,
  timestamptz, text, numeric, numeric, numeric, text, text, text, text, text,
  text, timestamptz, bigint
) to service_role;
grant execute on function public.get_owned_atomic_launch_intent(text, text, text)
  to service_role;

commit;
