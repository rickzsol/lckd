begin;

create table if not exists public.launch_intents (
  id uuid primary key default gen_random_uuid(),
  github_id text not null,
  creator_wallet text not null,
  mint_address text not null unique,
  metadata_uri text not null,
  image_uri text not null,
  config jsonb not null,
  create_tx text,
  create_blockhash text,
  create_last_valid_block_height bigint,
  lock_tx text,
  lock_metadata_id text,
  lock_amount text,
  unlock_timestamp bigint,
  lock_blockhash text,
  lock_last_valid_block_height bigint,
  status text not null default 'prepared'
    check (status in ('prepared', 'create_submitted', 'create_finalized', 'lock_submitted', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (
    status in ('prepared', 'abandoned') or (
      create_tx is not null and
      create_blockhash is not null and
      create_last_valid_block_height is not null
    )
  ),
  check (lock_tx is not null or status not in ('lock_submitted', 'completed'))
);

create index if not exists launch_intents_owner_status_idx
  on public.launch_intents (github_id, creator_wallet, status, updated_at desc);
create unique index if not exists launch_intents_one_active_owner_idx
  on public.launch_intents (github_id, creator_wallet)
  where status not in ('completed', 'abandoned');

alter table public.launch_intents enable row level security;
revoke all on public.launch_intents from anon, authenticated;

create or replace function public.prepare_launch_intent(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_metadata_uri text,
  p_image_uri text,
  p_config jsonb,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_id uuid;
begin
  insert into public.launch_intents as intent (
    github_id, creator_wallet, mint_address, metadata_uri, image_uri,
    config, status, updated_at, expires_at
  ) values (
    p_github_id, p_creator_wallet, p_mint_address, p_metadata_uri, p_image_uri,
    p_config, 'prepared', clock_timestamp(), p_expires_at
  )
  on conflict (mint_address) do update set
    updated_at = intent.updated_at
  where intent.github_id = excluded.github_id
    and intent.creator_wallet = excluded.creator_wallet
    and intent.status = 'prepared'
    and intent.metadata_uri = excluded.metadata_uri
    and intent.image_uri = excluded.image_uri
    and intent.config = excluded.config
  returning id into intent_id;

  if intent_id is null then
    raise exception 'Mint is already reserved' using errcode = '23505';
  end if;
  return intent_id;
end;
$$;

create or replace function public.checkpoint_create_submitted(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_create_tx text,
  p_create_blockhash text,
  p_create_last_valid_block_height bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.launch_intents set
    create_tx = p_create_tx,
    create_blockhash = p_create_blockhash,
    create_last_valid_block_height = p_create_last_valid_block_height,
    status = 'create_submitted',
    updated_at = clock_timestamp()
  where github_id = p_github_id
    and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address
    and (
      status = 'prepared' or (
        status = 'create_submitted' and
        create_tx = p_create_tx and
        create_blockhash = p_create_blockhash and
        create_last_valid_block_height = p_create_last_valid_block_height
      )
    );
  if found then return true; end if;
  return exists (
    select 1 from public.launch_intents
    where github_id = p_github_id
      and creator_wallet = p_creator_wallet
      and mint_address = p_mint_address
      and create_tx = p_create_tx
      and status in ('create_finalized', 'lock_submitted', 'completed')
  );
end;
$$;

create or replace function public.checkpoint_create_finalized(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_create_tx text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.launch_intents set
    status = 'create_finalized',
    updated_at = clock_timestamp()
  where github_id = p_github_id
    and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address
    and create_tx = p_create_tx
    and status = 'create_submitted';
  if found then return true; end if;
  return exists (
    select 1 from public.launch_intents
    where github_id = p_github_id
      and creator_wallet = p_creator_wallet
      and mint_address = p_mint_address
      and create_tx = p_create_tx
      and status in ('create_finalized', 'lock_submitted', 'completed')
  );
end;
$$;

create or replace function public.checkpoint_lock_submitted(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_previous_lock_tx text,
  p_lock_tx text,
  p_lock_metadata_id text,
  p_lock_amount text,
  p_unlock_timestamp bigint,
  p_lock_blockhash text,
  p_lock_last_valid_block_height bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.launch_intents
    where github_id = p_github_id
      and creator_wallet = p_creator_wallet
      and mint_address = p_mint_address
      and status = 'lock_submitted'
      and lock_tx = p_lock_tx
      and lock_metadata_id = p_lock_metadata_id
      and lock_amount = p_lock_amount
      and unlock_timestamp = p_unlock_timestamp
      and lock_blockhash = p_lock_blockhash
      and lock_last_valid_block_height = p_lock_last_valid_block_height
  ) then
    return true;
  end if;

  update public.launch_intents set
    lock_tx = p_lock_tx,
    lock_metadata_id = p_lock_metadata_id,
    lock_amount = p_lock_amount,
    unlock_timestamp = p_unlock_timestamp,
    lock_blockhash = p_lock_blockhash,
    lock_last_valid_block_height = p_lock_last_valid_block_height,
    status = 'lock_submitted',
    updated_at = clock_timestamp()
  where github_id = p_github_id
    and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address
    and (
      (status = 'create_finalized' and lock_tx is null and p_previous_lock_tx is null) or
      (
        status = 'lock_submitted' and
        p_previous_lock_tx is not null and
        lock_tx = p_previous_lock_tx and
        p_lock_tx <> p_previous_lock_tx
      )
    );
  return found;
end;
$$;

create or replace function public.record_verified_launch(
  p_github_id text,
  p_creator_wallet text,
  p_mint_address text,
  p_metadata_uri text,
  p_launch_tx text,
  p_lock_tx text,
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
  p_verified_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_id uuid;
  intent_status text;
  intent_create_tx text;
  intent_lock_tx text;
  intent_metadata_uri text;
  intent_image_uri text;
  intent_config jsonb;
  token_id uuid;
  was_existing boolean;
begin
  select id, status, create_tx, lock_tx, metadata_uri, image_uri, config
  into intent_id, intent_status, intent_create_tx, intent_lock_tx,
       intent_metadata_uri, intent_image_uri, intent_config
  from public.launch_intents
  where github_id = p_github_id
    and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address
  for update;

  if intent_id is null or
     intent_status not in ('lock_submitted', 'completed') or
     intent_create_tx <> p_launch_tx or
     intent_lock_tx <> p_lock_tx or
     intent_metadata_uri <> p_metadata_uri or
     intent_image_uri <> p_image_uri or
     p_launch_tx = p_lock_tx then
    raise exception 'Launch intent does not match finalized receipts' using errcode = '23514';
  end if;

  if intent_config->>'name' is distinct from p_name or
     intent_config->>'ticker' is distinct from p_ticker or
     intent_config->>'description' is distinct from p_description or
     intent_config->>'githubUsername' is distinct from p_github_username or
     intent_config->>'githubRepo' is distinct from p_github_repo or
     intent_config->>'liveUrl' is distinct from p_live_url or
     intent_config->>'twitterUrl' is distinct from p_twitter_url or
     intent_config->>'telegramUrl' is distinct from p_telegram_url or
     intent_config->>'websiteUrl' is distinct from p_website_url or
     (intent_config->>'lockDurationDays')::integer <> p_lock_duration_days or
     p_lock_percentage > (intent_config->>'lockPercentage')::numeric or
     p_lock_debited_amount + 10 <
       p_purchased_amount * (intent_config->>'lockPercentage')::numeric / 100 or
     p_buy_amount_sol > (intent_config->>'buyAmountSol')::numeric * 1.10 then
    raise exception 'Finalized launch does not match reviewed configuration' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.tokens where mint_address = p_mint_address
  ) into was_existing;

  insert into public.tokens as token (
    mint_address, name, ticker, description, image_uri, creator_wallet,
    lock_tx, lock_duration_days, lock_percentage, lock_unlock_at, lock_amount,
    buy_amount_sol, github_username, github_repo, live_url, trust_tier,
    launch_tx, twitter_url, telegram_url, website_url,
    launch_verified_at, lock_verified_at
  ) values (
    p_mint_address, p_name, p_ticker, p_description, p_image_uri, p_creator_wallet,
    p_lock_tx, p_lock_duration_days, p_lock_percentage, p_lock_unlock_at, p_lock_amount,
    p_buy_amount_sol, p_github_username, p_github_repo, p_live_url, 1,
    p_launch_tx, p_twitter_url, p_telegram_url, p_website_url,
    p_verified_at, p_verified_at
  )
  on conflict (mint_address) do update set
    name = excluded.name,
    ticker = excluded.ticker,
    description = excluded.description,
    image_uri = excluded.image_uri,
    lock_tx = excluded.lock_tx,
    lock_duration_days = excluded.lock_duration_days,
    lock_percentage = excluded.lock_percentage,
    lock_unlock_at = excluded.lock_unlock_at,
    lock_amount = excluded.lock_amount,
    buy_amount_sol = excluded.buy_amount_sol,
    github_username = excluded.github_username,
    github_repo = excluded.github_repo,
    live_url = excluded.live_url,
    twitter_url = excluded.twitter_url,
    telegram_url = excluded.telegram_url,
    website_url = excluded.website_url,
    launch_verified_at = excluded.launch_verified_at,
    lock_verified_at = excluded.lock_verified_at
  where token.creator_wallet = excluded.creator_wallet
    and token.launch_tx = excluded.launch_tx
  returning id into token_id;

  if token_id is null then
    raise exception 'Token ownership or launch receipt changed' using errcode = '23514';
  end if;

  update public.launch_intents set
    status = 'completed',
    updated_at = clock_timestamp()
  where id = intent_id;

  return was_existing;
end;
$$;

revoke all on function public.prepare_launch_intent(text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.checkpoint_create_submitted(text, text, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.checkpoint_create_finalized(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.checkpoint_lock_submitted(text, text, text, text, text, text, text, bigint, text, bigint)
  from public, anon, authenticated;
revoke all on function public.record_verified_launch(text, text, text, text, text, text, text, text, text, text, integer, numeric, timestamptz, text, numeric, numeric, numeric, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_launch_intent(text, text, text, text, text, jsonb, timestamptz)
  to service_role;
grant execute on function public.checkpoint_create_submitted(text, text, text, text, text, bigint)
  to service_role;
grant execute on function public.checkpoint_create_finalized(text, text, text, text)
  to service_role;
grant execute on function public.checkpoint_lock_submitted(text, text, text, text, text, text, text, bigint, text, bigint)
  to service_role;
grant execute on function public.record_verified_launch(text, text, text, text, text, text, text, text, text, text, integer, numeric, timestamptz, text, numeric, numeric, numeric, text, text, text, text, text, text, timestamptz)
  to service_role;

commit;
