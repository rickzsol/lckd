-- Allocation transparency: dev-declared wallet buckets per token, the
-- indexed transfer ledger for those wallets, and reconciliation snapshots.
-- Declarations are append-only: a changed bucket is retired and replaced,
-- never rewritten, so the public history cannot be edited after the fact.
-- All writes go through the service role; every table except the webhook
-- registry is publicly readable so token pages can prove each figure.

create table if not exists public.allocation_buckets (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  category text not null check (category in (
    'treasury', 'marketing', 'airdrops', 'community',
    'contributors', 'liquidity', 'other'
  )),
  label text not null check (char_length(label) between 1 and 40),
  declared_amount text not null check (declared_amount ~ '^[0-9]{1,20}$'),
  status text not null default 'active' check (status in ('active', 'retired')),
  superseded_by uuid references public.allocation_buckets(id),
  declared_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);

create index if not exists allocation_buckets_token_idx
  on public.allocation_buckets (token_id, status);

create table if not exists public.allocation_wallets (
  id uuid primary key default gen_random_uuid(),
  bucket_id uuid not null references public.allocation_buckets(id) on delete cascade,
  token_id uuid not null references public.tokens(id) on delete cascade,
  wallet_address text not null check (char_length(wallet_address) between 32 and 44),
  balance_at_declaration text not null check (balance_at_declaration ~ '^[0-9]{1,20}$'),
  is_creator_wallet boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now()
);

-- A wallet can serve at most one live bucket per token; retired rows are
-- kept for history and released from the constraint.
create unique index if not exists allocation_wallets_active_unique
  on public.allocation_wallets (token_id, wallet_address)
  where status = 'active';

create index if not exists allocation_wallets_bucket_idx
  on public.allocation_wallets (bucket_id);

create table if not exists public.allocation_transfers (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  wallet_address text not null check (char_length(wallet_address) between 32 and 44),
  direction text not null check (direction in ('in', 'out')),
  amount text not null check (amount ~ '^[0-9]{1,20}$'),
  counterparty_wallet text check (
    counterparty_wallet is null
    or char_length(counterparty_wallet) between 32 and 44
  ),
  classification text not null check (classification in (
    'distributed', 'sold', 'internal', 'burned', 'received', 'unknown'
  )),
  source text check (source is null or char_length(source) <= 40),
  signature text not null check (char_length(signature) between 64 and 90),
  slot bigint check (slot is null or slot >= 0),
  block_time timestamptz,
  recorded_via text not null default 'webhook'
    check (recorded_via in ('webhook', 'backfill')),
  created_at timestamptz not null default now(),
  -- Idempotency key: Helius retries and reconciliation backfills may replay
  -- the same movement; one ledger row per movement per tracked wallet.
  unique (signature, wallet_address, direction, amount)
);

create index if not exists allocation_transfers_token_time_idx
  on public.allocation_transfers (token_id, block_time desc);

create index if not exists allocation_transfers_wallet_idx
  on public.allocation_transfers (wallet_address);

create table if not exists public.allocation_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens(id) on delete cascade,
  wallet_address text not null check (char_length(wallet_address) between 32 and 44),
  balance text not null check (balance ~ '^[0-9]{1,20}$'),
  -- Signed raw difference between the transfer ledger and the chain balance
  -- at capture time; null means the ledger reconciled exactly.
  drift text check (drift is null or drift ~ '^-?[0-9]{1,20}$'),
  captured_at timestamptz not null default now()
);

create index if not exists allocation_snapshots_token_time_idx
  on public.allocation_snapshots (token_id, captured_at desc);

-- Singleton registry for the shared Helius webhook that carries every
-- tracked wallet. Internal state, so it is not publicly readable.
create table if not exists public.helius_webhook_state (
  id boolean primary key default true check (id),
  webhook_id text not null,
  address_count integer not null default 0 check (address_count >= 0),
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.allocation_buckets enable row level security;
alter table public.allocation_wallets enable row level security;
alter table public.allocation_transfers enable row level security;
alter table public.allocation_snapshots enable row level security;
alter table public.helius_webhook_state enable row level security;

drop policy if exists "allocation_buckets_public_read" on public.allocation_buckets;
create policy "allocation_buckets_public_read"
  on public.allocation_buckets for select
  to anon, authenticated
  using (true);

drop policy if exists "allocation_wallets_public_read" on public.allocation_wallets;
create policy "allocation_wallets_public_read"
  on public.allocation_wallets for select
  to anon, authenticated
  using (true);

drop policy if exists "allocation_transfers_public_read" on public.allocation_transfers;
create policy "allocation_transfers_public_read"
  on public.allocation_transfers for select
  to anon, authenticated
  using (true);

drop policy if exists "allocation_snapshots_public_read" on public.allocation_snapshots;
create policy "allocation_snapshots_public_read"
  on public.allocation_snapshots for select
  to anon, authenticated
  using (true);

revoke all on public.allocation_buckets from anon, authenticated;
revoke all on public.allocation_wallets from anon, authenticated;
revoke all on public.allocation_transfers from anon, authenticated;
revoke all on public.allocation_snapshots from anon, authenticated;
revoke all on public.helius_webhook_state from anon, authenticated;

grant select on public.allocation_buckets to anon, authenticated;
grant select on public.allocation_wallets to anon, authenticated;
grant select on public.allocation_transfers to anon, authenticated;
grant select on public.allocation_snapshots to anon, authenticated;

grant select, insert, update on public.allocation_buckets to service_role;
grant select, insert, update on public.allocation_wallets to service_role;
grant select, insert on public.allocation_transfers to service_role;
grant select, insert on public.allocation_snapshots to service_role;
grant select, insert, update on public.helius_webhook_state to service_role;
