-- ---- 0067_interview_materials_and_sent.sql ----
-- Interview Manager — per-interview materials snapshot + "details sent" stamp
-- Run AFTER 0066_telegram_formatting.sql. Idempotent — safe to re-run.
--
-- (1) Snapshot the candidate's materials onto the interview at request time so
--     the admin can see exactly which résumé / links were submitted FOR THIS
--     interview (they used to live only on the mutable profile).
-- (2) Record when the admin last sent the meeting details, so the UI can show
--     "details sent 2m ago" and avoid double-sends.

alter table public.interview_requests add column if not exists resume_path     text;
alter table public.interview_requests add column if not exists resume_url      text;
alter table public.interview_requests add column if not exists portfolio_url   text;
alter table public.interview_requests add column if not exists linkedin_url    text;
alter table public.interview_requests add column if not exists github_url      text;
alter table public.interview_requests add column if not exists applicant_phone text;
alter table public.interview_requests add column if not exists details_sent_at timestamptz;
