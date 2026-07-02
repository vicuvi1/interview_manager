-- Interview Manager — two-way Telegram commands + candidate-shared availability
-- Run AFTER 0034_reminders_rules_attention.sql.

-- ============================================================
-- Two-way Telegram: a per-bot webhook secret. Telegram echoes it in the
-- X-Telegram-Bot-Api-Secret-Token header so our webhook can identify the user.
-- ============================================================
alter table public.telegram_settings add column if not exists webhook_secret text;
create unique index if not exists telegram_settings_webhook_secret_uidx
  on public.telegram_settings (webhook_secret) where webhook_secret is not null;

-- ============================================================
-- Reverse booking: candidates share windows they're free; the admin picks one.
-- ============================================================
create table if not exists public.candidate_availability (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists candidate_availability_cand_idx
  on public.candidate_availability (candidate_id, starts_at);

alter table public.candidate_availability enable row level security;

-- Candidate manages their own windows.
drop policy if exists "cand_avail_owner_all" on public.candidate_availability;
create policy "cand_avail_owner_all" on public.candidate_availability
  for all using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id);

-- Admins can read everyone's windows (to schedule against them).
drop policy if exists "cand_avail_admin_read" on public.candidate_availability;
create policy "cand_avail_admin_read" on public.candidate_availability
  for select using (public.is_admin());

alter table public.candidate_availability replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.candidate_availability;
exception when duplicate_object then null; end $$;
