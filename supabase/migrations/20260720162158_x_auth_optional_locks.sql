begin;

create table public.auth_profiles (
  id uuid primary key default gen_random_uuid(),
  identity_id text not null unique,
  provider text not null check (provider in ('github', 'twitter')),
  provider_account_id text not null,
  username text not null,
  avatar_url text,
  wallet_address text,
  last_refreshed timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_account_id),
  check (identity_id = provider || ':' || provider_account_id),
  check (btrim(username) <> '')
);

create unique index auth_profiles_wallet_unique
  on public.auth_profiles (wallet_address)
  where wallet_address is not null;
create index auth_profiles_provider_username_idx
  on public.auth_profiles (provider, lower(username));

insert into public.auth_profiles (
  identity_id, provider, provider_account_id, username, avatar_url,
  wallet_address, last_refreshed
)
select
  'github:' || github_id, 'github', github_id, github_username, github_avatar,
  wallet_address, last_refreshed
from public.github_profiles
on conflict (identity_id) do update set
  username = excluded.username,
  avatar_url = excluded.avatar_url,
  wallet_address = coalesce(public.auth_profiles.wallet_address, excluded.wallet_address),
  last_refreshed = excluded.last_refreshed;

alter table public.auth_profiles enable row level security;
revoke all on public.auth_profiles from public, anon, authenticated;
grant select (id, provider, username, avatar_url, wallet_address, created_at)
  on public.auth_profiles to anon, authenticated;
grant select, insert, update on public.auth_profiles to service_role;

create policy "auth_profiles_select" on public.auth_profiles
  for select to anon, authenticated
  using (true);

alter table public.tokens
  add column has_lock boolean not null default true,
  add column creator_provider text,
  add column creator_username text;

update public.tokens
set creator_provider = 'github', creator_username = github_username
where github_username is not null;

alter table public.tokens
  drop constraint if exists tokens_lock_duration_days_check,
  drop constraint if exists tokens_lock_percentage_actual_check,
  drop constraint if exists tokens_lock_verification_consistent,
  drop constraint if exists tokens_tier_requires_verified_lock;

alter table public.tokens
  add constraint tokens_lock_duration_optional_check check (
    (has_lock and lock_duration_days between 7 and 365) or
    (not has_lock and lock_duration_days = 0)
  ),
  add constraint tokens_lock_percentage_optional_check check (
    (has_lock and lock_percentage > 0 and lock_percentage <= 100) or
    (not has_lock and lock_percentage = 0)
  ),
  add constraint tokens_lock_receipt_optional_check check (
    (has_lock and lock_verified_at is not null and lock_tx <> '' and
      lock_unlock_at is not null and lock_amount ~ '^[0-9]+$' and lock_amount::numeric > 0) or
    (not has_lock and lock_verified_at is null and lock_tx = '' and
      lock_unlock_at is null and lock_amount = '0')
  ),
  add constraint tokens_creator_identity_check check (
    (creator_provider is null and creator_username is null) or
    (creator_provider in ('github', 'twitter') and creator_username is not null and
      btrim(creator_username) <> '')
  );

drop policy if exists "tokens_select" on public.tokens;
create policy "tokens_select" on public.tokens
  for select to anon, authenticated
  using (launch_verified_at is not null and (not has_lock or lock_verified_at is not null));

create or replace function public.record_verified_atomic_launch_v2(
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
  p_has_lock boolean,
  p_lock_duration_days integer,
  p_lock_percentage numeric,
  p_lock_unlock_at timestamptz,
  p_lock_amount text,
  p_lock_debited_amount numeric,
  p_purchased_amount numeric,
  p_buy_amount_sol numeric,
  p_github_username text,
  p_identity_provider text,
  p_identity_username text,
  p_github_repo text,
  p_live_url text,
  p_twitter_url text,
  p_telegram_url text,
  p_website_url text,
  p_verified_at timestamptz,
  p_expected_state_version bigint,
  p_burned_lckd_amount numeric,
  p_burn_executed_at timestamptz
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
  v_is_buyback_burn boolean;
  v_result jsonb;
begin
  if p_identity_provider not in ('github', 'twitter') or
     p_identity_username is null or
     pg_catalog.btrim(p_identity_username) = '' or
     not exists (
       select 1 from public.auth_profiles
       where identity_id = p_github_id and provider = p_identity_provider
         and username = p_identity_username and wallet_address = p_creator_wallet
     ) or
     (p_identity_provider = 'github' and p_github_username is distinct from p_identity_username) or
     (p_identity_provider = 'twitter' and p_github_username is not null) then
    raise exception 'Authenticated launch identity changed' using errcode = '23514';
  end if;

  if p_has_lock then
    if exists (
      select 1 from public.launch_intents
      where github_id = p_github_id and creator_wallet = p_creator_wallet
        and config->>'hasLock' = 'false'
        and status not in ('completed', 'abandoned', 'failed')
    ) then
      raise exception 'Launch intent does not include a token lock' using errcode = '23514';
    end if;

    v_result := public.record_verified_atomic_launch(
      p_github_id, p_creator_wallet, p_mint_address, p_metadata_uri, p_atomic_tx,
      p_lock_metadata_id, p_name, p_ticker, p_description, p_image_uri,
      p_lock_duration_days, p_lock_percentage, p_lock_unlock_at, p_lock_amount,
      p_lock_debited_amount, p_purchased_amount, p_buy_amount_sol, p_github_username,
      p_github_repo, p_live_url, p_twitter_url, p_telegram_url, p_website_url,
      p_verified_at, p_expected_state_version, p_burned_lckd_amount, p_burn_executed_at
    );
    update public.tokens set
      has_lock = true,
      creator_provider = p_identity_provider,
      creator_username = p_identity_username
    where mint_address = p_mint_address and creator_wallet = p_creator_wallet
      and launch_tx = p_atomic_tx;
    return v_result;
  end if;

  if p_atomic_tx is null or p_lock_metadata_id is null or
     p_lock_duration_days <> 0 or p_lock_percentage <> 0 or
     p_lock_unlock_at is not null or p_lock_amount <> '0' or
     p_lock_debited_amount <> 0 or p_purchased_amount <= 0 or
     p_buy_amount_sol <= 0 or p_verified_at is null then
    raise exception 'Invalid finalized unlocked launch' using errcode = '22023';
  end if;

  select * into v_intent from public.launch_intents
  where github_id = p_github_id and creator_wallet = p_creator_wallet
    and mint_address = p_mint_address and launch_mode = 'atomic'
  for update;
  if not found then raise exception 'Atomic launch not found' using errcode = '55000'; end if;
  select * into v_alt from public.launch_alt_resources
  where intent_id = v_intent.id for update;
  if not found then raise exception 'ALT recovery state not found' using errcode = '55000'; end if;

  v_is_buyback_burn := v_intent.config @>
    '{"feeMode":"buybackBurn","feeLamports":100000000}'::jsonb;
  if (v_is_buyback_burn and (
        p_burned_lckd_amount is null or p_burned_lckd_amount <= 0 or p_burn_executed_at is null
      )) or (not v_is_buyback_burn and (
        p_burned_lckd_amount is not null or p_burn_executed_at is not null
      )) then
    raise exception 'Invalid finalized buyback ledger values' using errcode = '22023';
  end if;

  if v_intent.status = 'completed' and v_intent.atomic_tx = p_atomic_tx and
     v_intent.metadata_address = p_lock_metadata_id and
     v_intent.lock_metadata_id = p_lock_metadata_id and exists (
       select 1 from public.tokens where mint_address = p_mint_address
         and creator_wallet = p_creator_wallet and launch_tx = p_atomic_tx
         and not has_lock and lock_tx = '' and lock_amount = '0'
         and creator_provider = p_identity_provider and creator_username = p_identity_username
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
     v_intent.metadata_uri <> p_metadata_uri or v_intent.image_uri <> p_image_uri or
     v_intent.lock_amount <> '0' or v_intent.unlock_timestamp <> 0 then
    raise exception 'Atomic unlocked receipt does not match launch intent' using errcode = '23514';
  end if;
  if v_intent.config->>'hasLock' is distinct from 'false' or
     v_intent.config->>'name' is distinct from p_name or
     v_intent.config->>'ticker' is distinct from p_ticker or
     v_intent.config->>'description' is distinct from p_description or
     v_intent.config->>'githubUsername' is distinct from p_github_username or
     v_intent.config->>'githubRepo' is distinct from p_github_repo or
     v_intent.config->>'liveUrl' is distinct from p_live_url or
     v_intent.config->>'twitterUrl' is distinct from p_twitter_url or
     v_intent.config->>'telegramUrl' is distinct from p_telegram_url or
     v_intent.config->>'websiteUrl' is distinct from p_website_url or
     v_intent.metadata->>'metadataUri' is distinct from p_metadata_uri or
     v_intent.metadata->>'imageUri' is distinct from p_image_uri or
     v_intent.metadata->>'name' is distinct from p_name or
     v_intent.metadata->>'ticker' is distinct from p_ticker or
     v_intent.metadata->>'description' is distinct from p_description or
     p_purchased_amount <> v_intent.quoted_token_amount::numeric or
     p_buy_amount_sol * 1000000000 <
       pg_catalog.round((v_intent.config->>'buyAmountSol')::numeric * 1000000000) or
     p_buy_amount_sol * 1000000000 > v_intent.max_quote_amount::numeric then
    raise exception 'Finalized unlocked launch changed reviewed configuration' using errcode = '23514';
  end if;

  select exists (select 1 from public.tokens where mint_address = p_mint_address)
    into v_was_existing;
  insert into public.tokens as token (
    mint_address, name, ticker, description, image_uri, creator_wallet,
    has_lock, lock_tx, lock_duration_days, lock_percentage, lock_unlock_at, lock_amount,
    buy_amount_sol, github_username, creator_provider, creator_username,
    github_repo, live_url, trust_tier, launch_tx, twitter_url, telegram_url,
    website_url, launch_verified_at, lock_verified_at
  ) values (
    p_mint_address, p_name, p_ticker, p_description, p_image_uri, p_creator_wallet,
    false, '', 0, 0, null, '0', p_buy_amount_sol, p_github_username,
    p_identity_provider, p_identity_username, p_github_repo, p_live_url, 1,
    p_atomic_tx, p_twitter_url, p_telegram_url, p_website_url, p_verified_at, null
  )
  on conflict (mint_address) do update set
    name = excluded.name, ticker = excluded.ticker, description = excluded.description,
    image_uri = excluded.image_uri, has_lock = excluded.has_lock,
    lock_tx = excluded.lock_tx, lock_duration_days = excluded.lock_duration_days,
    lock_percentage = excluded.lock_percentage, lock_unlock_at = excluded.lock_unlock_at,
    lock_amount = excluded.lock_amount, buy_amount_sol = excluded.buy_amount_sol,
    github_username = excluded.github_username, creator_provider = excluded.creator_provider,
    creator_username = excluded.creator_username, github_repo = excluded.github_repo,
    live_url = excluded.live_url, twitter_url = excluded.twitter_url,
    telegram_url = excluded.telegram_url, website_url = excluded.website_url,
    launch_verified_at = excluded.launch_verified_at, lock_verified_at = excluded.lock_verified_at
  where token.creator_wallet = excluded.creator_wallet and token.launch_tx = excluded.launch_tx
  returning id into v_token_id;
  if v_token_id is null then
    raise exception 'Token ownership or receipt changed' using errcode = '23514';
  end if;

  if v_is_buyback_burn then
    insert into public.burn_events as burn_event (
      kind, signature, sol_amount, lckd_amount, executed_at
    ) values ('burn', p_atomic_tx, 0.1, p_burned_lckd_amount, p_burn_executed_at)
    on conflict (signature) do update set
      kind = excluded.kind, sol_amount = excluded.sol_amount,
      lckd_amount = excluded.lckd_amount, executed_at = excluded.executed_at;
  else
    update public.launch_alt_resources set
      status = 'deactivating', deactivation_tx = p_atomic_tx,
      deactivation_blockhash = v_intent.atomic_blockhash,
      deactivation_last_valid_block_height = v_intent.atomic_last_valid_block_height,
      state_version = state_version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = v_alt.id and status = 'ready';
    if not found then
      raise exception 'ALT deactivation state changed' using errcode = '40001';
    end if;
  end if;

  update public.launch_intents set
    status = 'completed', state_version = state_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where id = v_intent.id;
  return public.atomic_launch_state_result(v_intent.id, false, v_was_existing);
end;
$$;

revoke all on function public.record_verified_atomic_launch_v2(
  text, text, text, text, text, text, text, text, text, text, boolean,
  integer, numeric, timestamptz, text, numeric, numeric, numeric, text, text,
  text, text, text, text, text, text, timestamptz, bigint, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_verified_atomic_launch_v2(
  text, text, text, text, text, text, text, text, text, text, boolean,
  integer, numeric, timestamptz, text, numeric, numeric, numeric, text, text,
  text, text, text, text, text, text, timestamptz, bigint, numeric, timestamptz
) to service_role;

commit;
