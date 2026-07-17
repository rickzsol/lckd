begin;

create or replace function public.get_public_launch_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with verified_tokens as (
    select
      token.creator_wallet,
      token.github_username,
      token.trust_tier,
      token.lock_amount,
      token.lock_unlock_at
    from public.tokens as token
    where token.launch_verified_at is not null
      and token.lock_verified_at is not null
  ), active_intents as (
    select distinct intent.creator_wallet
    from public.launch_intents as intent
    where intent.expires_at > pg_catalog.statement_timestamp()
      and intent.updated_at >= pg_catalog.statement_timestamp() - interval '1 hour'
      and intent.status in (
        'prepared', 'alt_setup_submitted', 'alt_ready', 'atomic_submitted'
      )
  )
  select pg_catalog.jsonb_build_object(
    'launched', (select pg_catalog.count(*) from verified_tokens),
    'total_locked_tokens', (
      select coalesce(pg_catalog.sum(
        case
          when lock_amount ~ '^[0-9]+$' then lock_amount::numeric
          else 0
        end
      ), 0) / 1000000
      from verified_tokens
      where lock_unlock_at > pg_catalog.statement_timestamp()
    ),
    'devs_verified', (
      select pg_catalog.count(distinct token.creator_wallet)
      from verified_tokens as token
      where token.trust_tier >= 2
        and exists (
          select 1
          from public.github_profiles as profile
          where profile.wallet_address = token.creator_wallet
            and pg_catalog.lower(profile.github_username) =
              pg_catalog.lower(token.github_username)
            and profile.account_created_at <=
              pg_catalog.statement_timestamp() - interval '180 days'
            and profile.public_repos > 0
        )
    ),
    'building_now', (select pg_catalog.count(*) from active_intents),
    'as_of', pg_catalog.statement_timestamp()
  );
$$;

revoke all on function public.get_public_launch_stats() from public;
grant execute on function public.get_public_launch_stats() to anon, authenticated, service_role;

commit;
