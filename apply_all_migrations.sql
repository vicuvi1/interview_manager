-- ============================================================
-- Interview Manager - ALL migrations combined (run once).
-- Paste this whole file into Supabase -> SQL Editor -> Run.
-- Safe to re-run (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 0001_init.sql
-- ------------------------------------------------------------
-- Interview Manager â€” initial schema (Phase 1: candidate dashboard)
-- Paste this into the Supabase SQL Editor and run it, or apply with the CLI.

-- =====================================================================
-- Tables
-- =====================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  timezone    text not null default 'UTC',
  role        text not null default 'candidate',
  created_at  timestamptz not null default now()
);

-- If a `profiles` table already existed (e.g. from another app), make sure the
-- columns this app needs are present. Non-destructive and idempotent.
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists timezone   text not null default 'UTC';
alter table public.profiles add column if not exists role       text not null default 'candidate';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create table if not exists public.interview_requests (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references auth.users (id) on delete cascade,
  role              text not null,
  preferred_at      timestamptz,
  duration_minutes  integer not null default 30,
  notes             text,
  status            text not null default 'pending'
                      check (status in ('pending','approved','rejected','scheduled','completed','cancelled')),
  payment_status    text not null default 'unpaid'
                      check (payment_status in ('unpaid','paid')),
  created_at        timestamptz not null default now()
);
create index if not exists interview_requests_candidate_idx
  on public.interview_requests (candidate_id, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  detail      text,
  type        text not null default 'info',
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles            enable row level security;
alter table public.interview_requests  enable row level security;
alter table public.notifications        enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "interviews_select_own" on public.interview_requests;
drop policy if exists "interviews_insert_own" on public.interview_requests;
drop policy if exists "interviews_update_own" on public.interview_requests;
create policy "interviews_select_own" on public.interview_requests
  for select using (auth.uid() = candidate_id);
create policy "interviews_insert_own" on public.interview_requests
  for insert with check (auth.uid() = candidate_id);
create policy "interviews_update_own" on public.interview_requests
  for update using (auth.uid() = candidate_id);

drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_insert_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id);

-- =====================================================================
-- New-user trigger: seed a profile + a welcome notification
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  )
  on conflict (id) do nothing;

  insert into public.notifications (user_id, title, detail, type)
  values (
    new.id,
    'Welcome to Interview Manager',
    'Request your first interview to get started.',
    'success'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Realtime (so the dashboard updates live)
-- =====================================================================
alter table public.interview_requests replica identity full;
alter table public.notifications      replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.interview_requests;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;


-- ------------------------------------------------------------
-- 0002_admin.sql
-- ------------------------------------------------------------
-- Interview Manager â€” admin role + policies (Phase 2: admin workspace)
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


-- ------------------------------------------------------------
-- 0003_scheduling.sql
-- ------------------------------------------------------------
-- Interview Manager â€” scheduling (Phase 3)
-- Run AFTER 0002_admin.sql.
--
-- Adds the confirmed time + meeting link the admin sets when scheduling.
-- The 'scheduled' status already exists from 0001; RLS already lets admins
-- update these columns and candidates read them.

alter table public.interview_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists meeting_link text;


-- ------------------------------------------------------------
-- 0004_payments.sql
-- ------------------------------------------------------------
-- Interview Manager â€” payments (Phase 4)
-- Run AFTER 0003_scheduling.sql.
--
-- The admin sets an invoice (price_cents); the candidate pays (mock checkout),
-- which flips payment_status to 'paid' and stamps paid_at. RLS already lets the
-- admin update any request and the candidate update their own.

alter table public.interview_requests
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists paid_at timestamptz;


-- ------------------------------------------------------------
-- 0005_auto_admin.sql
-- ------------------------------------------------------------
-- Interview Manager â€” auto-admin for a fixed account (Phase 5)
-- Run AFTER 0004_payments.sql.
--
-- After this runs, signing in with victorbarbuta54@gmail.com is automatically an
-- admin â€” no per-user SQL needed. (Revenue + admin calendar are app-only, no
-- schema needed.)

-- 1) Promote the designated account if it already exists.
update public.profiles
set role = 'admin'
where lower(email) = 'victorbarbuta54@gmail.com';

-- 2) is_admin(): admin by role OR by the designated email.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'admin' or lower(email) = 'victorbarbuta54@gmail.com')
  );
$$;

-- 3) New-user trigger: the designated email is created as an admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, timezone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    case
      when lower(new.email) = 'victorbarbuta54@gmail.com' then 'admin'
      else 'candidate'
    end
  )
  on conflict (id) do nothing;

  insert into public.notifications (user_id, title, detail, type)
  values (
    new.id,
    'Welcome to Interview Manager',
    'Request your first interview to get started.',
    'success'
  );

  return new;
end;
$$;


-- ------------------------------------------------------------
-- 0006_security.sql
-- ------------------------------------------------------------
-- Interview Manager â€” security hardening (Phase 6)
-- Run AFTER 0005_auto_admin.sql.
--
-- Goal: candidates can only create requests and read their own data. All
-- state changes that matter (status, payment, schedule) happen either through
-- the admin (RLS is_admin) or through the SECURITY DEFINER functions below,
-- which enforce ownership + valid state. This closes the hole where a candidate
-- could self-approve or self-mark-paid by calling the table directly.

-- 1) Candidates may no longer directly UPDATE interview requests.
--    (The admin update policy from 0002 still applies.)
drop policy if exists "interviews_update_own" on public.interview_requests;

-- 2) Candidates may no longer self-insert notifications; the functions below
--    and admins create them.
drop policy if exists "notifications_insert_own" on public.notifications;

-- 3) Prevent privilege escalation through the API: no one may change
--    profiles.role via PostgREST. Replace the blanket UPDATE grant with a
--    column allow-list. (The signup trigger sets role as SECURITY DEFINER.)
revoke update on public.profiles from authenticated;
grant update (full_name, email, timezone) on public.profiles to authenticated;

-- 4) Value constraints (RLS guards who, not what).
do $$ begin
  alter table public.interview_requests
    add constraint interview_requests_duration_chk
    check (duration_minutes between 5 and 480);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.interview_requests
    add constraint interview_requests_price_chk
    check (price_cents is null or price_cents >= 0);
exception when duplicate_object then null; end $$;

-- 5) Candidate pays their own invoice (mock). Swap the body for a Stripe call
--    + webhook to go live; the ownership/state checks stay the same.
create or replace function public.pay_interview(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.interview_requests;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if r.price_cents is null then raise exception 'Nothing to pay'; end if;
  if r.payment_status = 'paid' then return; end if;

  update public.interview_requests
    set payment_status = 'paid', paid_at = now()
    where id = p_interview_id;

  insert into public.notifications (user_id, title, detail, type)
  values (
    r.candidate_id,
    'Payment confirmed',
    'Your payment for "' || r.role || '" was received.',
    'success'
  );
end;
$$;

-- 6) Candidate cancels their own pending/approved/scheduled request.
create or replace function public.cancel_my_request(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.interview_requests;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if r.status not in ('pending', 'approved', 'scheduled') then
    raise exception 'This request can no longer be cancelled';
  end if;

  update public.interview_requests set status = 'cancelled' where id = p_interview_id;
end;
$$;

grant execute on function public.pay_interview(uuid) to authenticated;
grant execute on function public.cancel_my_request(uuid) to authenticated;

