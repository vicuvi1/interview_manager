-- ---- 0048_resume_library.sql ----
-- Interview Manager — reusable résumé library
-- Run AFTER 0047_booking_profiles.sql. Idempotent — safe to re-run.
--
-- Instead of re-uploading a résumé on every booking, users add named résumés
-- once (Settings → Résumés) — "Resume 1", "Frontend CV", … — and pick one from
-- the list when booking. Files live in the existing private "resumes" bucket
-- (owner read/write, admin read); this table just tracks the named entries.

create table if not exists public.resume_library (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  file_path  text, -- storage path in the 'resumes' bucket (null for a link-only entry)
  file_url   text, -- external link (null for an uploaded file)
  created_at timestamptz not null default now()
);

create index if not exists resume_library_user_idx
  on public.resume_library (user_id, created_at desc);

alter table public.resume_library enable row level security;

drop policy if exists "resume_library_owner_all" on public.resume_library;
create policy "resume_library_owner_all" on public.resume_library
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admins can see everyone's entries (they already read the files themselves).
drop policy if exists "resume_library_admin_select" on public.resume_library;
create policy "resume_library_admin_select" on public.resume_library
  for select using (public.is_admin());
