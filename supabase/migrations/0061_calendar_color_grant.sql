-- ---- 0061_calendar_color_grant.sql ----
-- Interview Manager — let the calendar_color column actually be written.
-- Run AFTER 0060_schedule_rpc.sql. Idempotent — safe to re-run.
--
-- 0039 added profiles.calendar_color and 0032 gave admins a row-level UPDATE
-- policy, but 0006 had revoked blanket UPDATE on profiles in favour of explicit
-- column grants (full_name, email, timezone; later resume_path, email prefs).
-- calendar_color was never added to that grant list, so setting a person's
-- calendar colour was rejected at the column-privilege level — the write failed
-- silently and the colour reverted on the next refetch/reload.
--
-- Granting UPDATE on just this column lets it be written. Which ROWS a user may
-- update is still governed by RLS: profiles_update_own (their own row) and
-- profiles_update_admin (admins → any row), so admins can colour any candidate.

grant update (calendar_color) on public.profiles to authenticated;
