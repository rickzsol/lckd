-- Burn ledger: one row per executed buyback or burn transaction.
-- Written only by the treasury worker through the service role;
-- publicly readable so the /burn page and API can prove every entry.

create table if not exists public.burn_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('buyback', 'burn')),
  signature text not null unique,
  sol_amount numeric,
  lckd_amount numeric,
  executed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (kind <> 'buyback' or (sol_amount is not null and sol_amount > 0)),
  check (lckd_amount is null or lckd_amount > 0)
);

create index if not exists burn_events_executed_at_idx
  on public.burn_events (executed_at desc);

alter table public.burn_events enable row level security;

drop policy if exists "burn_events_public_read" on public.burn_events;
create policy "burn_events_public_read"
  on public.burn_events for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.burn_events from anon, authenticated;
grant select on public.burn_events to anon, authenticated;
grant select, insert on public.burn_events to service_role;
