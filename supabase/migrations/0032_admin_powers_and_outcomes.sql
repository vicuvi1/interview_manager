-- Interview Manager — admin powers + richer interview outcomes
-- Run AFTER 0031_colors_and_mark_paid.sql.

-- 1) Admins can DELETE a request (remove it from the approval system entirely).
drop policy if exists "interviews_delete_admin" on public.interview_requests;
create policy "interviews_delete_admin" on public.interview_requests
  for delete using (public.is_admin());

-- 2) Admins can UPDATE any profile — so they can rename/relabel users to make
--    them easier to track. (Read access already exists via profiles_select_admin.)
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- 3) Post-interview details the admin fills in and shares with the candidate:
--    how long the interview actually ran, and a to-do / action list.
alter table public.interview_feedback add column if not exists actual_minutes integer;
alter table public.interview_feedback add column if not exists action_items text;

-- These live on interview_feedback, so they inherit the existing RLS:
--   * admins can read/write everything (feedback_admin_all)
--   * candidates can read them only when the row is shared (feedback_candidate_read)
