-- Interview Manager — availability & calendar blocks (Phase 5)
-- Run AFTER 0007_payments.sql.
--
-- One table backs three kinds of admin-managed calendar blocks:
--   available — green, bookable windows (candidate booking lands here later)
--   busy      — blocked time; candidates can't book over it
--   event     — a custom event / manual interview note (optional candidate link)
-- repeat_rule expands client-side over the visible range (none/daily/weekly).

create table if not exists public.availability_slots (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  slot_type    text not null default 'available'
                 check (slot_type in ('available', 'busy', 'event')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  repeat_rule  text not null default 'none'
                 check (repeat_rule in ('none', 'daily', 'weekly')),
  is_booked    boolean not null default false,
  candidate_id uuid references public.profiles (id) on delete set null,
  meeting_link text,
  notes        text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists availability_slots_time_idx
  on public.availability_slots (starts_at);

alter table public.availability_slots enable row level security;

-- Admins manage every slot.
drop policy if exists "availability_admin_all" on public.availability_slots;
create policy "availability_admin_all" on public.availability_slots
  for all using (public.is_admin()) with check (public.is_admin());

-- Any signed-in user can read slots (candidates need available/busy to book).
drop policy if exists "availability_select_auth" on public.availability_slots;
create policy "availability_select_auth" on public.availability_slots
  for select using (auth.uid() is not null);

alter table public.availability_slots replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.availability_slots;
exception when duplicate_object then null; end $$;
