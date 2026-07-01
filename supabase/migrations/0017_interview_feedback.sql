-- Interview Manager — interview feedback & outcomes
-- Run AFTER 0016_storage_and_cleanup.sql.
--
-- One scorecard per interview. Admins write it; the candidate can only read the
-- parts explicitly shared with them (shared = true), and never the private
-- concerns/notes.

create table if not exists public.interview_feedback (
  id              uuid primary key default gen_random_uuid(),
  interview_id    uuid not null references public.interview_requests (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  outcome         text not null default 'hold'
                    check (outcome in ('advance', 'hold', 'reject', 'no_show')),
  rating          integer check (rating between 1 and 5),
  strengths       text,
  concerns        text,
  shared_feedback text,
  shared          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists interview_feedback_interview_uidx
  on public.interview_feedback (interview_id);

alter table public.interview_feedback enable row level security;

drop policy if exists "feedback_admin_all" on public.interview_feedback;
create policy "feedback_admin_all" on public.interview_feedback
  for all using (public.is_admin()) with check (public.is_admin());

-- Candidate can read ONLY feedback that was shared, and only for their own interview.
drop policy if exists "feedback_candidate_read" on public.interview_feedback;
create policy "feedback_candidate_read" on public.interview_feedback
  for select using (
    shared and exists (
      select 1 from public.interview_requests ir
      where ir.id = interview_id and ir.candidate_id = auth.uid()
    )
  );

alter table public.interview_feedback replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.interview_feedback;
exception when duplicate_object then null; end $$;
