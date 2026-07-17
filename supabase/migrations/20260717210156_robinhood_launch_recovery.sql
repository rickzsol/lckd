begin;

create table if not exists public.robinhood_launch_intents (
  id uuid primary key default gen_random_uuid(),
  github_id text not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 4663 check (chain_id = 4663),
  factory_address text not null default '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb'
    check (factory_address = '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb'),
  salt text not null check (salt ~ '^0x[0-9a-f]{64}$'),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  initial_buy_wei text not null check (initial_buy_wei ~ '^(0|[1-9][0-9]*)$'),
  prepared_block_number bigint not null check (prepared_block_number >= 0),
  last_scanned_block bigint not null check (last_scanned_block >= -1),
  transaction_hash text check (
    transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  token_address text check (token_address is null or token_address ~ '^0x[0-9a-f]{40}$'),
  pool_address text check (pool_address is null or pool_address ~ '^0x[0-9a-f]{40}$'),
  position_id text check (position_id is null or position_id ~ '^(0|[1-9][0-9]*)$'),
  failure_reason text,
  status text not null default 'prepared'
    check (status in ('prepared', 'ambiguous', 'submitted', 'verified', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (github_id <> ''),
  check (expires_at > created_at),
  check (failure_reason is null or char_length(failure_reason) <= 500),
  check (
    (status = 'prepared' and transaction_hash is null and token_address is null and
      pool_address is null and position_id is null and failure_reason is null) or
    (status = 'ambiguous' and transaction_hash is null and token_address is null and
      pool_address is null and position_id is null and failure_reason is null) or
    (status = 'submitted' and transaction_hash is not null and token_address is null and
      pool_address is null and position_id is null and failure_reason is null) or
    (status = 'verified' and transaction_hash is not null and token_address is not null and
      pool_address is not null and position_id is not null and failure_reason is null) or
    (status = 'failed' and token_address is null and pool_address is null and
      position_id is null and failure_reason is not null)
  )
);

create unique index if not exists robinhood_launch_intents_active_owner_idx
  on public.robinhood_launch_intents (github_id, wallet_address)
  where status in ('prepared', 'ambiguous', 'submitted');

create unique index if not exists robinhood_launch_intents_owner_salt_idx
  on public.robinhood_launch_intents (github_id, wallet_address, salt);

create index if not exists robinhood_launch_intents_owner_updated_idx
  on public.robinhood_launch_intents (github_id, wallet_address, updated_at desc);

alter table public.robinhood_launch_intents enable row level security;
revoke all on public.robinhood_launch_intents from anon, authenticated;
grant all on public.robinhood_launch_intents to service_role;

commit;
