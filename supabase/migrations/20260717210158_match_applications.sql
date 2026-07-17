begin;

create table if not exists public.match_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  github_id text not null,
  github_username text not null,
  project_name text not null check (char_length(project_name) between 2 and 64),
  ticker text check (ticker is null or ticker ~ '^[A-Z0-9]{1,10}$'),
  pitch text not null check (char_length(pitch) between 1 and 500),
  repo text check (repo is null or repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  buy_amount_sol numeric not null check (buy_amount_sol >= 0.1 and buy_amount_sol <= 100),
  lock_duration_days integer not null check (lock_duration_days >= 30 and lock_duration_days <= 365),
  contact text check (contact is null or char_length(contact) <= 64),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected'))
);

create index if not exists match_applications_github_id_idx
  on public.match_applications (github_id);

create index if not exists match_applications_created_at_idx
  on public.match_applications (created_at desc);

alter table public.match_applications enable row level security;
revoke all on public.match_applications from anon, authenticated;
grant all on public.match_applications to service_role;

commit;
