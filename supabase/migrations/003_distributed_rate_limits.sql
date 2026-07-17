begin;

create table if not exists public.api_rate_limit_buckets (
  key_hash text primary key check (length(key_hash) = 64),
  request_count integer not null check (request_count > 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limit_buckets_expires_at_idx
  on public.api_rate_limit_buckets (expires_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on public.api_rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  is_allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
  current_expiry timestamptz;
  checked_at timestamptz := clock_timestamp();
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate limit key' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit window' using errcode = '22023';
  end if;

  insert into public.api_rate_limit_buckets as bucket (
    key_hash,
    request_count,
    window_started_at,
    expires_at,
    updated_at
  ) values (
    p_key_hash,
    1,
    checked_at,
    checked_at + make_interval(secs => p_window_seconds),
    checked_at
  )
  on conflict (key_hash) do update set
    request_count = case
      when bucket.expires_at <= checked_at then 1
      else bucket.request_count + 1
    end,
    window_started_at = case
      when bucket.expires_at <= checked_at then checked_at
      else bucket.window_started_at
    end,
    expires_at = case
      when bucket.expires_at <= checked_at
        then checked_at + make_interval(secs => p_window_seconds)
      else bucket.expires_at
    end,
    updated_at = checked_at
  returning request_count, expires_at
  into current_count, current_expiry;

  delete from public.api_rate_limit_buckets
  where key_hash = (
    select stale.key_hash
    from public.api_rate_limit_buckets as stale
    where stale.expires_at < checked_at - interval '5 minutes'
    order by stale.expires_at
    limit 1
  );

  is_allowed := current_count <= p_limit;
  remaining := greatest(p_limit - current_count, 0);
  retry_after_seconds := case
    when is_allowed then 0
    else greatest(ceil(extract(epoch from current_expiry - checked_at))::integer, 1)
  end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

commit;
