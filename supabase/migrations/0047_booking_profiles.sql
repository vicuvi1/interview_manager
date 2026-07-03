-- ---- 0047_booking_profiles.sql ----
-- Interview Manager — reusable "person" profiles for the booking form
-- Run AFTER 0046_per_user_email_prefs.sql. Idempotent — safe to re-run.
--
-- Lets a user save the repeating details for a person (name, resume, portfolio,
-- LinkedIn, GitHub, phone) under a label ("Steven", "Braden", …) and one-click
-- fill the booking form instead of retyping every time. Each row is private to
-- its owner.

create table if not exists public.booking_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  label         text not null,
  full_name     text,
  phone         text,
  linkedin_url  text,
  github_url    text,
  portfolio_url text,
  resume_url    text,
  resume_path   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists booking_profiles_user_idx
  on public.booking_profiles (user_id, label);

alter table public.booking_profiles enable row level security;

drop policy if exists "booking_profiles_owner_all" on public.booking_profiles;
create policy "booking_profiles_owner_all" on public.booking_profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
