-- Interview Manager — admin role + policies (Phase 2: admin workspace)
-- Run this AFTER 0001_init.sql.
--
-- To make yourself an admin, run (with your email):
--   update public.profiles set role = 'admin' where email = 'you@example.com';

-- Helper: is the current user an admin? SECURITY DEFINER so it bypasses RLS on
-- profiles (avoids recursive policy evaluation).
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Admins can read every profile (to show candidate names/emails/timezones).
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

-- Admins can see and update every interview request.
drop policy if exists "interviews_select_admin" on public.interview_requests;
create policy "interviews_select_admin" on public.interview_requests
  for select using (public.is_admin());

drop policy if exists "interviews_update_admin" on public.interview_requests;
create policy "interviews_update_admin" on public.interview_requests
  for update using (public.is_admin());

-- Admins can create notifications for any user (approve / reject / etc.).
drop policy if exists "notifications_insert_admin" on public.notifications;
create policy "notifications_insert_admin" on public.notifications
  for insert with check (public.is_admin());
