-- Interview Manager — initial schema (Phase 1: candidate dashboard)
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
