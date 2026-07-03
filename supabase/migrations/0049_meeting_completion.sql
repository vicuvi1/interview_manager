-- ---- 0049_meeting_completion.sql ----
-- Interview Manager — post-meeting summary the admin sends on completion
-- Run AFTER 0048_resume_library.sql. Idempotent — safe to re-run.
--
-- When an admin marks an interview completed they can send the candidate the
-- meeting URL (a link only — no video), how long the meeting actually lasted,
-- and optional notes. Stored on the request so it also shows on the candidate's
-- interview; the existing notification triggers forward it to Telegram/email.

alter table public.interview_requests
  add column if not exists recording_url    text;
alter table public.interview_requests
  add column if not exists actual_minutes   integer;
alter table public.interview_requests
  add column if not exists completion_notes text;
alter table public.interview_requests
  add column if not exists completed_at     timestamptz;
