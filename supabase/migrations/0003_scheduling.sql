-- Interview Manager — scheduling (Phase 3)
-- Run AFTER 0002_admin.sql.
--
-- Adds the confirmed time + meeting link the admin sets when scheduling.
-- The 'scheduled' status already exists from 0001; RLS already lets admins
-- update these columns and candidates read them.

alter table public.interview_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists meeting_link text;
