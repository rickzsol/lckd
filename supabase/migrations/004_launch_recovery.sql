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
    check (status in ('prepared', 'create_submitted', 'create_finalized', 'lock_submitted', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (
    status = 'prepared' or (
      create_tx is not null and
      create_blockhash is not null and
      create_last_valid_block_height is not null
    )
  ),
  check (lock_tx is not null or status not in ('lock_submitted', 'completed'))
);

create index if not exists launch_intents_owner_status_idx
  on public.launch_intents (github_id, creator_wallet, status, updated_at desc);

alter table public.launch_intents enable row level security;
revoke all on public.launch_intents from anon, authenticated;

commit;
