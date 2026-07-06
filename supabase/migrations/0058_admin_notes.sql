-- ---- 0058_admin_notes.sql ----
-- Interview Manager — private per-interview notes only admins can see
-- Run AFTER 0057_interview_attachments.sql. Idempotent — safe to re-run.
--
-- Kept in a SEPARATE table (not a column on interview_requests) because
-- candidates can read their own interview row — a column there would leak to
-- them. RLS here is admin-only, so candidates can't read these notes at all.

create table if not exists public.interview_admin_notes (
  interview_id uuid primary key references public.interview_requests(id) on delete cascade,
  notes        text,
  updated_at   timestamptz not null default now()
);

alter table public.interview_admin_notes enable row level security;

drop policy if exists "interview_admin_notes_admin_all" on public.interview_admin_notes;
create policy "interview_admin_notes_admin_all" on public.interview_admin_notes
  for all using (public.is_admin()) with check (public.is_admin());
