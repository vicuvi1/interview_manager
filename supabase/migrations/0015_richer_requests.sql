-- Interview Manager — richer interview requests + candidate materials
-- Run AFTER 0014_telegram_reminders.sql.
--
-- Candidates can now submit far more context with a request, and keep reusable
-- profile materials (résumé, links, phone). The admin reviews it all and
-- approves or declines.

-- Per-request detail the candidate fills in.
alter table public.interview_requests
  add column if not exists interview_type text,
  add column if not exists level          text,
  add column if not exists focus_areas    text[],
  add column if not exists format         text default 'video',
  add column if not exists goals          text;

-- Reusable materials on the candidate's own profile.
alter table public.profiles
  add column if not exists phone         text,
  add column if not exists linkedin_url  text,
  add column if not exists github_url    text,
  add column if not exists portfolio_url text,
  add column if not exists resume_url    text,
  add column if not exists bio           text;

-- Candidates may edit their own materials. (0006 restricted profile updates to a
-- column allow-list; extend it — role/blocked stay ungranted so they can't be
-- self-set.) RLS profiles_update_own still scopes writes to the owner's row.
grant update (phone, linkedin_url, github_url, portfolio_url, resume_url, bio)
  on public.profiles to authenticated;
