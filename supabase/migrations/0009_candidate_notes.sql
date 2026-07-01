-- Interview Manager — private admin notes on candidates (Phase 6)
-- Run AFTER 0008_availability.sql.
--
-- Admin-only. Candidates can never read or write these rows (RLS grants no
-- candidate policy), so notes stay private to the admin team.

create table if not exists public.candidate_notes (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists candidate_notes_candidate_idx
  on public.candidate_notes (candidate_id, created_at desc);

alter table public.candidate_notes enable row level security;

drop policy if exists "candidate_notes_admin_all" on public.candidate_notes;
create policy "candidate_notes_admin_all" on public.candidate_notes
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.candidate_notes replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.candidate_notes;
exception when duplicate_object then null; end $$;
