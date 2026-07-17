-- Trust tier: 1=LOCKED, 2=VERIFIED, 3=BUILDER, 4=SHIPPED

create table tokens (
  id uuid primary key default gen_random_uuid(),
  mint_address text not null unique,
  name text not null,
  ticker text not null,
  description text not null,
  image_uri text not null,
  creator_wallet text not null,
  lock_tx text not null,
  lock_duration_days integer not null check (lock_duration_days between 7 and 365),
  lock_percentage integer not null check (lock_percentage between 50 and 100),
  lock_amount text not null,
  buy_amount_sol numeric not null,
  github_username text,
  github_repo text,
  live_url text,
  trust_tier integer not null default 1 check (trust_tier between 1 and 4),
  launch_tx text not null,
  created_at timestamptz not null default now(),
  twitter_url text,
  telegram_url text,
  website_url text
);

create table github_profiles (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  github_id text not null unique,
  github_username text not null,
  github_avatar text not null,
  account_created_at timestamptz not null,
  public_repos integer not null default 0,
  total_commits integer not null default 0,
  last_refreshed timestamptz not null default now()
);

-- Indexes
create index idx_tokens_creator_wallet on tokens (creator_wallet);
create index idx_tokens_trust_tier on tokens (trust_tier);
create index idx_tokens_created_at on tokens (created_at desc);
create index idx_github_profiles_wallet on github_profiles (wallet_address);

-- RLS
alter table tokens enable row level security;
alter table github_profiles enable row level security;

-- Tokens: publicly readable
create policy "tokens_select" on tokens
  for select using (true);

-- Tokens: authenticated users can insert
create policy "tokens_insert" on tokens
  for insert to authenticated
  with check (true);

-- Tokens: only creator can update their own tokens
create policy "tokens_update" on tokens
  for update to authenticated
  using (creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub')
  with check (creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub');

-- GitHub profiles: publicly readable
create policy "github_profiles_select" on github_profiles
  for select using (true);

-- GitHub profiles: wallet owner can insert
create policy "github_profiles_insert" on github_profiles
  for insert to authenticated
  with check (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

-- GitHub profiles: wallet owner can update
create policy "github_profiles_update" on github_profiles
  for update to authenticated
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub')
  with check (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');
