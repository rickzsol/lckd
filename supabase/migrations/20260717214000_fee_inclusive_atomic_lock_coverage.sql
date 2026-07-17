begin;

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
  v_reviewed_debit numeric;
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

  v_reviewed_debit := pg_catalog.floor(
    p_purchased_amount * (v_intent.config->>'lockPercentage')::numeric / 100
  );
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
     p_lock_debited_amount + 10 < v_reviewed_debit or
     p_lock_debited_amount > v_reviewed_debit + 10 or
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

revoke all on function public.record_verified_atomic_launch(
  text, text, text, text, text, text, text, text, text, text, integer, numeric,
  timestamptz, text, numeric, numeric, numeric, text, text, text, text, text,
  text, timestamptz, bigint
) from public, anon, authenticated;

grant execute on function public.record_verified_atomic_launch(
  text, text, text, text, text, text, text, text, text, text, integer, numeric,
  timestamptz, text, numeric, numeric, numeric, text, text, text, text, text,
  text, timestamptz, bigint
) to service_role;

commit;
