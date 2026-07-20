begin;

create table public.proof_submissions (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null
    check (mission_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(mission_key) <= 64),
  mint_address text not null
    check (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  contributor_github_id text not null
    check (contributor_github_id ~ '^[0-9]{1,32}$'),
  contributor_github_username text not null
    check (contributor_github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  contributor_wallet text not null
    check (contributor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  evidence_url text not null
    check (evidence_url ~ '^https://' and char_length(evidence_url) <= 2048),
  evidence_note text not null
    check (char_length(evidence_note) between 40 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index proof_submissions_active_contributor_idx
  on public.proof_submissions (mission_key, contributor_github_id)
  where status in ('pending', 'accepted');

create index proof_submissions_mission_status_idx
  on public.proof_submissions (mission_key, status, created_at desc);

create table public.proof_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.proof_submissions (id) on delete cascade,
  reviewer_github_id text not null
    check (reviewer_github_id ~ '^[0-9]{1,32}$'),
  reviewer_github_username text not null
    check (reviewer_github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  reviewer_wallet text not null
    check (reviewer_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  decision text not null check (decision in ('approve', 'reject')),
  created_at timestamptz not null default now(),
  unique (submission_id, reviewer_github_id)
);

create index proof_reviews_submission_decision_idx
  on public.proof_reviews (submission_id, decision);

create function public.validate_proof_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  submission_contributor_id text;
  submission_status text;
begin
  select contributor_github_id, status
    into submission_contributor_id, submission_status
    from public.proof_submissions
    where id = new.submission_id
    for update;

  if not found then
    raise exception 'Proof submission does not exist';
  end if;

  if submission_contributor_id = new.reviewer_github_id then
    raise exception 'Contributors cannot review their own proof';
  end if;

  if submission_status <> 'pending' then
    raise exception 'Only pending proof submissions can be reviewed';
  end if;

  return new;
end;
$$;

create function public.finalize_proof_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  approval_count integer;
  rejection_count integer;
begin
  select
    count(*) filter (where decision = 'approve'),
    count(*) filter (where decision = 'reject')
    into approval_count, rejection_count
    from public.proof_reviews
    where submission_id = new.submission_id;

  if rejection_count > 0 then
    update public.proof_submissions
      set status = 'rejected', reviewed_at = now()
      where id = new.submission_id;
  elsif approval_count >= 2 then
    update public.proof_submissions
      set status = 'accepted', reviewed_at = now()
      where id = new.submission_id;
  end if;

  return new;
end;
$$;

create trigger validate_proof_review_before_insert
  before insert on public.proof_reviews
  for each row execute function public.validate_proof_review();

create trigger finalize_proof_review_after_insert
  after insert on public.proof_reviews
  for each row execute function public.finalize_proof_review();

alter table public.proof_submissions enable row level security;
alter table public.proof_reviews enable row level security;

revoke all on public.proof_submissions from anon, authenticated;
revoke all on public.proof_reviews from anon, authenticated;
revoke all on function public.validate_proof_review() from public, anon, authenticated;
revoke all on function public.finalize_proof_review() from public, anon, authenticated;

grant all on public.proof_submissions to service_role;
grant all on public.proof_reviews to service_role;
grant execute on function public.validate_proof_review() to service_role;
grant execute on function public.finalize_proof_review() to service_role;

commit;
