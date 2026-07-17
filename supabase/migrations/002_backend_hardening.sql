begin;

-- OAuth profiles exist before a wallet is linked. NULL avoids collisions between
-- unlinked users while the partial index preserves one-wallet-per-profile ownership.
alter table public.github_profiles
  alter column wallet_address drop not null;

update public.github_profiles
set wallet_address = null
where btrim(wallet_address) = '';

alter table public.github_profiles
  drop constraint if exists github_profiles_wallet_address_key;

create unique index if not exists github_profiles_wallet_address_unique
  on public.github_profiles (wallet_address)
  where wallet_address is not null;

alter table public.tokens
  add column if not exists launch_verified_at timestamptz,
  add column if not exists lock_verified_at timestamptz,
  add column if not exists lock_unlock_at timestamptz;

alter table public.tokens
  drop constraint if exists tokens_lock_percentage_check,
  alter column lock_percentage type numeric(7,4)
  using lock_percentage::numeric;

alter table public.tokens
  add constraint tokens_lock_percentage_actual_check
  check (lock_percentage > 0 and lock_percentage <= 100) not valid;

create unique index if not exists tokens_launch_tx_unique
  on public.tokens (launch_tx)
  where launch_tx <> '';

create unique index if not exists tokens_lock_tx_unique
  on public.tokens (lock_tx)
  where lock_tx <> '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tokens_launch_verification_consistent'
      and conrelid = 'public.tokens'::regclass
  ) then
    alter table public.tokens
      add constraint tokens_launch_verification_consistent
      check (launch_verified_at is null or launch_tx <> '') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tokens_lock_verification_consistent'
      and conrelid = 'public.tokens'::regclass
  ) then
    alter table public.tokens
      add constraint tokens_lock_verification_consistent
      check (
        lock_verified_at is null or (
          lock_tx <> '' and
          lock_unlock_at is not null and
          lock_duration_days > 0 and
          lock_percentage between 1 and 100 and
          lock_amount ~ '^[0-9]+$' and
          lock_amount::numeric > 0
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tokens_tier_requires_verified_lock'
      and conrelid = 'public.tokens'::regclass
  ) then
    alter table public.tokens
      add constraint tokens_tier_requires_verified_lock
      check (lock_verified_at is not null) not valid;
  end if;
end
$$;

-- Public clients are read-only. Authenticated mutations are performed by the
-- server after NextAuth, linked-wallet, origin, and on-chain verification.
drop policy if exists "tokens_insert" on public.tokens;
drop policy if exists "tokens_update" on public.tokens;
drop policy if exists "github_profiles_insert" on public.github_profiles;
drop policy if exists "github_profiles_update" on public.github_profiles;

drop policy if exists "tokens_select" on public.tokens;
create policy "tokens_select" on public.tokens
  for select to anon, authenticated
  using (launch_verified_at is not null and lock_verified_at is not null);

revoke select on public.github_profiles from anon, authenticated;
grant select (
  id,
  wallet_address,
  github_username,
  github_avatar,
  account_created_at,
  public_repos,
  total_commits,
  last_refreshed
) on public.github_profiles to anon, authenticated;

commit;
