-- ============================================================
-- Interview Manager — all migrations, concatenated in order.
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to re-run (idempotent guards throughout).
-- ============================================================

-- ---- 0001_init.sql ----
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

-- ---- 0002_admin.sql ----
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

-- ---- 0003_scheduling.sql ----
-- Interview Manager — scheduling (Phase 3)
-- Run AFTER 0002_admin.sql.
--
-- Adds the confirmed time + meeting link the admin sets when scheduling.
-- The 'scheduled' status already exists from 0001; RLS already lets admins
-- update these columns and candidates read them.

alter table public.interview_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists meeting_link text;

-- ---- 0004_payments.sql ----
-- Interview Manager — payments (Phase 4)
-- Run AFTER 0003_scheduling.sql.
--
-- The admin sets an invoice (price_cents); the candidate pays (mock checkout),
-- which flips payment_status to 'paid' and stamps paid_at. RLS already lets the
-- admin update any request and the candidate update their own.

alter table public.interview_requests
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists paid_at timestamptz;

-- ---- 0005_auto_admin.sql ----
-- Interview Manager — auto-admin for a fixed account (Phase 5)
-- Run AFTER 0004_payments.sql.
--
-- After this runs, signing in with victorbarbuta54@gmail.com is automatically an
-- admin — no per-user SQL needed. (Revenue + admin calendar are app-only, no
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

-- ---- 0006_security.sql ----
-- Interview Manager — security hardening (Phase 6)
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

-- ---- 0007_payments.sql ----
-- Interview Manager — payments ledger (Phase 4)
-- Run AFTER 0006_security.sql.
--
-- Adapted to our schema: interview_id references interview_requests (not a
-- separate scheduled_interviews table), candidate_id references profiles.
-- The ledger is kept in sync with interview_requests' invoice/payment fields by
-- a trigger, so the existing candidate pay flow keeps working unchanged.

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interview_requests (id) on delete set null,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  amount       numeric(10, 2) not null default 0,
  currency     text not null default 'USD',
  method       text check (method in (
                 'crypto_btc', 'crypto_eth', 'crypto_sol', 'crypto_usdt_erc20',
                 'crypto_usdt_trc20', 'crypto_usdt_bep20', 'crypto_bnb',
                 'bank_transfer', 'cash', 'stripe', 'paypal', 'free', 'training')),
  status       text not null default 'pending'
                 check (status in ('pending', 'paid', 'overdue', 'refunded', 'partial', 'free')),
  paid_at      timestamptz,
  notes        text,
  receipt_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One "invoice" payment per interview (manual payments have interview_id null).
create unique index if not exists payments_interview_uidx
  on public.payments (interview_id) where interview_id is not null;
create index if not exists payments_candidate_idx
  on public.payments (candidate_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select using (auth.uid() = candidate_id);

alter table public.payments replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; end $$;

-- Backfill from existing invoices already recorded on interview_requests.
insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at, method)
select ir.id,
       ir.candidate_id,
       (ir.price_cents::numeric / 100.0),
       coalesce(ir.currency, 'USD'),
       case when ir.payment_status = 'paid' then 'paid' else 'pending' end,
       ir.paid_at,
       case when ir.payment_status = 'paid' then 'stripe' else null end
from public.interview_requests ir
where ir.price_cents is not null
on conflict (interview_id) where interview_id is not null do nothing;

-- Keep the ledger in sync with interview_requests invoice/payment changes.
create or replace function public.sync_payment_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price_cents is not null then
    insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at)
    values (
      new.id,
      new.candidate_id,
      (new.price_cents::numeric / 100.0),
      coalesce(new.currency, 'USD'),
      case when new.payment_status = 'paid' then 'paid' else 'pending' end,
      new.paid_at
    )
    on conflict (interview_id) where interview_id is not null do update set
      amount = excluded.amount,
      currency = excluded.currency,
      status = case when new.payment_status = 'paid' then 'paid' else payments.status end,
      paid_at = case when new.payment_status = 'paid' then new.paid_at else payments.paid_at end,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_interview_payment_sync on public.interview_requests;
create trigger on_interview_payment_sync
  after insert or update of price_cents, payment_status, paid_at, currency
  on public.interview_requests
  for each row execute function public.sync_payment_from_request();

-- ---- 0008_availability.sql ----
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

-- ---- 0009_candidate_notes.sql ----
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

-- ---- 0010_notifications_center.sql ----
-- Interview Manager — notification center support (Phase 7)
-- Run AFTER 0009_candidate_notes.sql.
--
-- 1) Users can clear (delete) their own notifications.
-- 2) Admins get a notification when a candidate files a new request, so the
--    admin notification center has live content.

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

create or replace function public.notify_admins_new_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, detail, type)
  select p.id,
         'New interview request',
         coalesce(nullif(cp.full_name, ''), cp.email, 'A candidate')
           || ' requested "' || new.role || '"',
         'info'
  from public.profiles p
  left join public.profiles cp on cp.id = new.candidate_id
  where p.role = 'admin';
  return new;
end;
$$;

drop trigger if exists on_new_request_notify_admins on public.interview_requests;
create trigger on_new_request_notify_admins
  after insert on public.interview_requests
  for each row execute function public.notify_admins_new_request();

-- ---- 0011_audit_log.sql ----
-- Interview Manager — audit log + admin manual controls (Phase 8)
-- Run AFTER 0010_notifications_center.sql.
--
-- Every meaningful change to an interview request is logged automatically by a
-- trigger (actor = the calling user), so the activity log is reliable no matter
-- who made the change or how (admin console, bulk action, or candidate RPC).

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null default 'interview',
  entity_id   uuid,
  summary     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_admin_select" on public.audit_log;
create policy "audit_log_admin_select" on public.audit_log
  for select using (public.is_admin());

drop policy if exists "audit_log_admin_insert" on public.audit_log;
create policy "audit_log_admin_insert" on public.audit_log
  for insert with check (public.is_admin());

alter table public.audit_log replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.audit_log;
exception when duplicate_object then null; end $$;

-- Admins can create requests on a candidate's behalf (manual booking).
drop policy if exists "interviews_insert_admin" on public.interview_requests;
create policy "interviews_insert_admin" on public.interview_requests
  for insert with check (public.is_admin());

-- Automatic audit trail for interview requests.
create or replace function public.log_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'created', 'interview', new.id,
      'Request "' || new.role || '" created'
        || case when new.status = 'scheduled' then ' and scheduled' else '' end);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'status', 'interview', new.id,
      new.role || ': ' || old.status || ' → ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id, 'Rescheduled "' || new.role || '"');
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' → ' || new.payment_status);
  end if;

  return new;
end;
$$;

drop trigger if exists on_interview_audit on public.interview_requests;
create trigger on_interview_audit
  after insert or update on public.interview_requests
  for each row execute function public.log_interview_change();

-- ---- 0012_interviewers.sql ----
-- Interview Manager — assigned interviewer (polish pass)
-- Run AFTER 0011_audit_log.sql.
--
-- Each request can be assigned to an interviewer (an admin). Nullable; existing
-- admin select/update RLS already covers reads and writes.

alter table public.interview_requests
  add column if not exists interviewer_id uuid references public.profiles (id) on delete set null;

create index if not exists interview_requests_interviewer_idx
  on public.interview_requests (interviewer_id);

-- ---- 0013_privacy_and_blocking.sql ----
-- Interview Manager — privacy hardening + user blocking
-- Run AFTER 0012_interviewers.sql.

-- 1) PRIVACY: candidates must never see each other's data.
--    availability_slots previously allowed any signed-in user to SELECT every
--    row — including "event" slots that can reference a specific candidate
--    (candidate_id, meeting_link, notes). No candidate feature reads this table,
--    so restrict SELECT to admins. (The admin_all policy from 0008 still applies.)
drop policy if exists "availability_select_auth" on public.availability_slots;

-- 2) BLOCKING: let admins suspend a user's access.
alter table public.profiles add column if not exists blocked boolean not null default false;

-- Is the current user blocked? SECURITY DEFINER to avoid RLS recursion.
create or replace function public.is_blocked()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select blocked from public.profiles where id = auth.uid()), false);
$$;

-- Blocked users can no longer create interview requests.
drop policy if exists "interviews_insert_own" on public.interview_requests;
create policy "interviews_insert_own" on public.interview_requests
  for insert with check (auth.uid() = candidate_id and not public.is_blocked());

-- Admin-only block/unblock. `blocked` is never a client-writable column
-- (profiles column grants exclude it), so this SECURITY DEFINER RPC is the only
-- path — it verifies is_admin(), logs to the audit trail, and notifies the user.
create or replace function public.set_user_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.profiles set blocked = p_blocked where id = p_user;

  select coalesce(nullif(full_name, ''), email, 'A user') into who
  from public.profiles where id = p_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when p_blocked then 'blocked' else 'unblocked' end,
    'user',
    p_user,
    who || case when p_blocked then ' was blocked' else ' was unblocked' end
  );

  insert into public.notifications (user_id, title, detail, type)
  values (
    p_user,
    case when p_blocked then 'Account suspended' else 'Account reinstated' end,
    case when p_blocked
         then 'Your access has been suspended. Please contact support.'
         else 'Your access has been restored. Welcome back.' end,
    case when p_blocked then 'alert' else 'success' end
  );
end;
$$;

grant execute on function public.set_user_blocked(uuid, boolean) to authenticated;

-- ---- 0014_telegram_reminders.sql ----
-- Interview Manager — Telegram interview reminders
-- Run AFTER 0013_privacy_and_blocking.sql.
--
-- Each admin can connect their own Telegram bot and choose how many minutes
-- before an interview to be reminded. A scheduled job (pg_cron) calls
-- process_interview_reminders() every minute, which sends due reminders via the
-- Telegram Bot API using pg_net.
--
-- ONE-TIME SETUP in Supabase (Dashboard → Database → Extensions, then SQL editor):
--   1. Enable extensions:  pg_net  and  pg_cron
--   2. Schedule the job:
--        select cron.schedule('interview-reminders', '* * * * *',
--          $$ select public.process_interview_reminders(); $$);
--   (To stop it later:  select cron.unschedule('interview-reminders');)

create table if not exists public.telegram_settings (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  bot_token        text not null,
  chat_id          text,
  bot_username     text,
  reminder_minutes integer not null default 15 check (reminder_minutes between 1 and 240),
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.telegram_settings enable row level security;

-- Only the owner (who must be an admin) can see or manage their row — this keeps
-- each admin's bot token private to them.
drop policy if exists "telegram_owner_all" on public.telegram_settings;
create policy "telegram_owner_all" on public.telegram_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_admin());

-- Dedupe: one reminder per (interview, recipient, offset).
create table if not exists public.reminder_log (
  id           uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interview_requests (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete cascade,
  minutes      integer not null,
  sent_at      timestamptz not null default now(),
  unique (interview_id, recipient_id, minutes)
);

alter table public.reminder_log enable row level security;
drop policy if exists "reminder_log_admin_select" on public.reminder_log;
create policy "reminder_log_admin_select" on public.reminder_log
  for select using (public.is_admin());

-- Sends any due reminders. Returns how many were sent. Requires the pg_net
-- extension (schema "net"); called by pg_cron (see setup notes above).
create or replace function public.process_interview_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s   record;
  iv  record;
  tz  text;
  msg text;
  sent integer := 0;
begin
  for s in
    select * from public.telegram_settings
    where enabled and chat_id is not null and bot_token is not null
  loop
    for iv in
      select ir.id, ir.role, ir.scheduled_at, ir.meeting_link,
             p.timezone as admin_tz,
             cp.full_name as cand_name, cp.email as cand_email
      from public.interview_requests ir
      join public.profiles p on p.id = s.user_id
      left join public.profiles cp on cp.id = ir.candidate_id
      where ir.status = 'scheduled'
        and ir.scheduled_at is not null
        and ir.scheduled_at > now()
        and ir.scheduled_at <= now() + make_interval(mins => s.reminder_minutes)
        and not exists (
          select 1 from public.reminder_log rl
          where rl.interview_id = ir.id
            and rl.recipient_id = s.user_id
            and rl.minutes = s.reminder_minutes
        )
    loop
      tz := coalesce(iv.admin_tz, 'UTC');
      msg := '⏰ Interview reminder' || E'\n'
          || 'Role: ' || iv.role || E'\n'
          || 'Candidate: ' || coalesce(nullif(iv.cand_name, ''), iv.cand_email, 'Unknown') || E'\n'
          || 'When: ' || to_char(iv.scheduled_at at time zone tz, 'Mon DD, HH24:MI') || ' (' || tz || ')'
          || case when iv.meeting_link is not null then E'\n' || 'Link: ' || iv.meeting_link else '' end;

      perform net.http_post(
        url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'chat_id', s.chat_id,
          'text', msg,
          'disable_web_page_preview', true
        )
      );

      insert into public.reminder_log (interview_id, recipient_id, minutes)
      values (iv.id, s.user_id, s.reminder_minutes);
      sent := sent + 1;
    end loop;
  end loop;
  return sent;
end;
$$;

-- Never callable directly by clients; only the scheduled job runs it.
revoke all on function public.process_interview_reminders() from public;
revoke all on function public.process_interview_reminders() from anon;
revoke all on function public.process_interview_reminders() from authenticated;

-- ---- 0015_richer_requests.sql ----
-- Interview Manager — richer interview requests + candidate materials
-- Run AFTER 0014_telegram_reminders.sql.
--
-- Candidates can now submit far more context with a request, and keep reusable
-- profile materials (résumé, links, phone). The admin reviews it all and
-- approves or declines.

-- Per-request detail the candidate fills in.
alter table public.interview_requests
  add column if not exists interview_type text,
  add column if not exists level          text,
  add column if not exists focus_areas    text[],
  add column if not exists format         text default 'video',
  add column if not exists goals          text;

-- Reusable materials on the candidate's own profile.
alter table public.profiles
  add column if not exists phone         text,
  add column if not exists linkedin_url  text,
  add column if not exists github_url    text,
  add column if not exists portfolio_url text,
  add column if not exists resume_url    text,
  add column if not exists bio           text;

-- Candidates may edit their own materials. (0006 restricted profile updates to a
-- column allow-list; extend it — role/blocked stay ungranted so they can't be
-- self-set.) RLS profiles_update_own still scopes writes to the owner's row.
grant update (phone, linkedin_url, github_url, portfolio_url, resume_url, bio)
  on public.profiles to authenticated;

-- ---- 0016_storage_and_cleanup.sql ----
-- Interview Manager — résumé uploads + storage/data admin tools
-- Run AFTER 0015_richer_requests.sql.

-- 1) Where an uploaded résumé lives (a path inside the private "resumes" bucket).
alter table public.profiles add column if not exists resume_path text;
grant update (resume_path) on public.profiles to authenticated;

-- 2) Private bucket for résumés. Files are namespaced by user id: "<uid>/<file>".
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Candidates manage only their own folder; admins can read every résumé.
drop policy if exists "resumes_owner_rw" on storage.objects;
create policy "resumes_owner_rw" on storage.objects
  for all
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes_admin_read" on storage.objects;
create policy "resumes_admin_read" on storage.objects
  for select
  using (bucket_id = 'resumes' and public.is_admin());

-- 3) Storage/usage stats for the admin panel (bytes per table + bucket size).
create or replace function public.get_storage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;

  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', tbl, 'rows', rows, 'bytes', bytes) order by bytes desc)
      from (
        select c.relname as tbl,
               greatest(c.reltuples, 0)::bigint as rows,
               pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      ) t
    ), '[]'::jsonb),
    'storage_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'resumes'), 0),
    'storage_files', coalesce((select count(*) from storage.objects where bucket_id = 'resumes'), 0)
  ) into result;

  return result;
end;
$$;
grant execute on function public.get_storage_stats() to authenticated;

-- 4) Cleanup actions to free space. Returns the number of rows removed.
create or replace function public.cleanup_data(p_target text, p_older_than_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_older_than_days, 0), 0));
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;

  if p_target = 'read_notifications' then
    delete from public.notifications where read and created_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'audit_log' then
    delete from public.audit_log where created_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'reminder_log' then
    delete from public.reminder_log where sent_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'closed_requests' then
    delete from public.interview_requests
      where status in ('cancelled', 'rejected') and created_at < cutoff;
    get diagnostics n = row_count;
  else
    raise exception 'Unknown cleanup target: %', p_target;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, summary)
  values (auth.uid(), 'cleanup', 'system',
    'Removed ' || n || ' ' || replace(p_target, '_', ' ') || ' older than ' || p_older_than_days || ' days');

  return n;
end;
$$;
grant execute on function public.cleanup_data(text, integer) to authenticated;

-- ---- 0017_interview_feedback.sql ----
-- Interview Manager — interview feedback & outcomes
-- Run AFTER 0016_storage_and_cleanup.sql.
--
-- One scorecard per interview. Admins write it; the candidate can only read the
-- parts explicitly shared with them (shared = true), and never the private
-- concerns/notes.

create table if not exists public.interview_feedback (
  id              uuid primary key default gen_random_uuid(),
  interview_id    uuid not null references public.interview_requests (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  outcome         text not null default 'hold'
                    check (outcome in ('advance', 'hold', 'reject', 'no_show')),
  rating          integer check (rating between 1 and 5),
  strengths       text,
  concerns        text,
  shared_feedback text,
  shared          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists interview_feedback_interview_uidx
  on public.interview_feedback (interview_id);

alter table public.interview_feedback enable row level security;

drop policy if exists "feedback_admin_all" on public.interview_feedback;
create policy "feedback_admin_all" on public.interview_feedback
  for all using (public.is_admin()) with check (public.is_admin());

-- Candidate can read ONLY feedback that was shared, and only for their own interview.
drop policy if exists "feedback_candidate_read" on public.interview_feedback;
create policy "feedback_candidate_read" on public.interview_feedback
  for select using (
    shared and exists (
      select 1 from public.interview_requests ir
      where ir.id = interview_id and ir.candidate_id = auth.uid()
    )
  );

alter table public.interview_feedback replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.interview_feedback;
exception when duplicate_object then null; end $$;

-- ---- 0018_email_notifications.sql ----
-- Interview Manager — email notifications via Resend
-- Run AFTER 0017_interview_feedback.sql.
--
-- Every in-app notification is also emailed to its recipient. Configure the
-- Resend API key + "from" address in Admin → Settings → Email. Requires the
-- pg_net extension (same as Telegram reminders).

-- Single-row config, admin-only. The API key stays server-side (RLS + never
-- returned to the browser by the API route).
create table if not exists public.app_email_config (
  id             integer primary key default 1 check (id = 1),
  resend_api_key text,
  email_from     text default 'Interview Scheduler <onboarding@resend.dev>',
  enabled        boolean not null default false,
  updated_at     timestamptz not null default now()
);

alter table public.app_email_config enable row level security;

drop policy if exists "email_config_admin_all" on public.app_email_config;
create policy "email_config_admin_all" on public.app_email_config
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_email_config (id) values (1) on conflict (id) do nothing;

-- Send an email for each new notification (fire-and-forget via pg_net).
create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.app_email_config;
  to_email text;
  html     text;
begin
  select * into cfg from public.app_email_config where id = 1;
  if cfg.id is null or not cfg.enabled or cfg.resend_api_key is null then
    return new;
  end if;

  select email into to_email from public.profiles where id = new.user_id;
  if to_email is null or to_email = '' then
    return new;
  end if;

  html := '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">'
       || '<h2 style="color:#111;font-size:18px">' || new.title || '</h2>'
       || '<p style="color:#444;font-size:14px;line-height:1.6">' || coalesce(new.detail, '') || '</p>'
       || '<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>'
       || '<p style="color:#999;font-size:12px">Interview Scheduler Pro</p></div>';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', coalesce(cfg.email_from, 'Interview Scheduler <onboarding@resend.dev>'),
      'to', to_email,
      'subject', new.title,
      'html', html
    )
  );

  return new;
end;
$$;

drop trigger if exists on_notification_email on public.notifications;
create trigger on_notification_email
  after insert on public.notifications
  for each row execute function public.email_on_notification();

-- ---- 0019_app_settings_retention.sql ----
-- Interview Manager — app settings + automatic data retention
-- Run AFTER 0018_email_notifications.sql.
--
-- Free-tier friendly: a scheduled job trims old rows so the database doesn't creep
-- toward the 500 MB limit. Schedule it with pg_cron (see note at the bottom).

create table if not exists public.app_settings (
  id                     integer primary key default 1 check (id = 1),
  retention_enabled      boolean not null default false,
  notifications_days     integer not null default 60,
  audit_days             integer not null default 90,
  reminder_days          integer not null default 30,
  closed_requests_days   integer not null default 60,
  resume_uploads_enabled boolean not null default true,
  updated_at             timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Any signed-in user can READ the flags (e.g. candidates need resume_uploads_enabled);
-- only admins can change them. No secrets live here.
drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings
  for select using (auth.uid() is not null);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Delete old rows per the configured windows. Returns how many were removed.
-- Safe for both pg_cron (runs as superuser, auth.uid() is null) and admins;
-- non-admin clients are rejected.
create or replace function public.run_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.app_settings;
  n   integer := 0;
  c   integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into cfg from public.app_settings where id = 1;
  if cfg.id is null or not cfg.retention_enabled then
    return 0;
  end if;

  delete from public.notifications
    where read and created_at < now() - make_interval(days => cfg.notifications_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.audit_log
    where created_at < now() - make_interval(days => cfg.audit_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.reminder_log
    where sent_at < now() - make_interval(days => cfg.reminder_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.interview_requests
    where status in ('cancelled', 'rejected')
      and created_at < now() - make_interval(days => cfg.closed_requests_days);
  get diagnostics c = row_count; n := n + c;

  if n > 0 then
    insert into public.audit_log (actor_id, action, entity_type, summary)
    values (auth.uid(), 'retention', 'system', 'Automatic cleanup removed ' || n || ' rows');
  end if;

  return n;
end;
$$;

grant execute on function public.run_retention() to authenticated;

-- ONE-TIME: schedule a daily 3am sweep (requires pg_cron):
--   select cron.schedule('data-retention', '0 3 * * *',
--     $$ select public.run_retention(); $$);

-- ---- 0020_resume_hygiene.sql ----
-- Interview Manager — résumé hygiene (free-tier storage control)
-- Run AFTER 0019_app_settings_retention.sql.

-- Admins can delete any résumé file (candidates already manage their own folder).
drop policy if exists "resumes_admin_delete" on storage.objects;
create policy "resumes_admin_delete" on storage.objects
  for delete using (bucket_id = 'resumes' and public.is_admin());

-- Admin clears a candidate's résumé pointer after removing the file. profiles is
-- not admin-writable directly, so this SECURITY DEFINER RPC is the path.
create or replace function public.admin_clear_resume(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set resume_path = null where id = p_user;
end;
$$;
grant execute on function public.admin_clear_resume(uuid) to authenticated;

-- ---- 0021_tags_and_templates.sql ----
-- Interview Manager — candidate tags + interview templates (lightweight org tools)
-- Run AFTER 0020_resume_hygiene.sql.

-- Candidate tags (admin-managed). profiles isn't admin-writable directly, so set
-- them through a SECURITY DEFINER RPC.
alter table public.profiles add column if not exists tags text[];

create or replace function public.set_candidate_tags(p_user uuid, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set tags = p_tags where id = p_user;
end;
$$;
grant execute on function public.set_candidate_tags(uuid, text[]) to authenticated;

-- Reusable interview templates (admin-only) to prefill manual bookings.
create table if not exists public.interview_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  role             text,
  interview_type   text,
  level            text,
  duration_minutes integer not null default 30,
  format           text default 'video',
  notes            text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table public.interview_templates enable row level security;

drop policy if exists "templates_admin_all" on public.interview_templates;
create policy "templates_admin_all" on public.interview_templates
  for all using (public.is_admin()) with check (public.is_admin());

-- ---- 0022_candidate_stage.sql ----
-- Interview Manager — candidate pipeline stage (HR → Technical → Final)
-- Run AFTER 0021_tags_and_templates.sql.

alter table public.profiles
  add column if not exists stage text not null default 'applied';

-- Admin moves a candidate along the pipeline. profiles isn't admin-writable
-- directly, so go through this SECURITY DEFINER RPC (logs + notifies).
create or replace function public.set_candidate_stage(p_user uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.profiles set stage = p_stage where id = p_user;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = p_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'stage', 'user', p_user, who || ' → ' || p_stage);

  insert into public.notifications (user_id, title, detail, type)
  values (
    p_user,
    case when p_stage = 'rejected' then 'Application update' else 'Interview progress' end,
    case when p_stage = 'rejected'
         then 'Thank you for interviewing with us. We won''t be moving forward at this time.'
         when p_stage = 'hired'
         then 'Great news — you''ve reached the offer stage!'
         else 'Your application has moved forward.' end,
    case when p_stage = 'rejected' then 'alert' else 'success' end
  );
end;
$$;

grant execute on function public.set_candidate_stage(uuid, text) to authenticated;

-- ---- 0023_payment_wallets.sql ----
-- Interview Manager — crypto wallet payments
-- Run AFTER 0022_candidate_stage.sql.
--
-- The admin lists their receiving wallets (USDT/USDC on BEP20/TRC20/etc). A
-- candidate picks one, sees the address, pays externally, and taps "I've paid".
-- The admin verifies and marks it paid. No amount is shown to the candidate, and
-- candidates can no longer self-mark paid.

create table if not exists public.payment_wallets (
  id         uuid primary key default gen_random_uuid(),
  asset      text not null,            -- USDT, USDC, BTC, ETH, BNB…
  network    text,                     -- BEP20, TRC20, ERC20, SOL…
  address    text not null,
  memo       text,                     -- optional memo/tag some chains need
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.payment_wallets enable row level security;

drop policy if exists "wallets_admin_all" on public.payment_wallets;
create policy "wallets_admin_all" on public.payment_wallets
  for all using (public.is_admin()) with check (public.is_admin());

-- Signed-in users can read active wallets so they can pay (addresses are meant
-- to be shared).
drop policy if exists "wallets_read_active" on public.payment_wallets;
create policy "wallets_read_active" on public.payment_wallets
  for select using (auth.uid() is not null and active);

-- A candidate tells the admins they've sent payment (they can't insert
-- notifications directly). Verified ownership; notifies every admin.
create or replace function public.notify_payment_sent(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.interview_requests;
  who text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id,
         'Payment sent',
         who || ' says they paid for "' || r.role || '". Please verify and mark it paid.',
         'alert'
  from public.profiles p
  where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid) to authenticated;

-- Candidates no longer self-mark paid — the admin verifies the transfer.
revoke execute on function public.pay_interview(uuid) from authenticated;

-- ---- 0024_booking_form.sql ----
-- Interview Manager — fix audit FK + richer booking fields
-- Run AFTER 0023_payment_wallets.sql.

-- 1) FIX: some auth users may have no profiles row (e.g. created before the
--    signup trigger existed during setup). The audit trigger then fails its FK
--    on insert and blocks booking. Backfill any missing profiles.
insert into public.profiles (id, email, full_name, timezone, role)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', ''),
       coalesce(u.raw_user_meta_data ->> 'timezone', 'UTC'),
       case when lower(u.email) = 'victorbarbuta54@gmail.com' then 'admin' else 'candidate' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- 2) Make the audit trigger resilient: if the actor somehow has no profile row,
--    log with a null actor instead of failing the whole insert.
create or replace function public.log_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is not null and not exists (select 1 from public.profiles where id = actor) then
    actor := null;
  end if;

  if TG_OP = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'created', 'interview', new.id,
      'Request "' || new.role || '" created'
        || case when new.status = 'scheduled' then ' and scheduled' else '' end);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'status', 'interview', new.id, new.role || ': ' || old.status || ' → ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id, 'Rescheduled "' || new.role || '"');
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' → ' || new.payment_status);
  end if;

  return new;
end;
$$;

-- 3) New booking fields: notes for the caller + a job description (link or file).
alter table public.interview_requests
  add column if not exists caller_notes   text,
  add column if not exists job_desc_url   text,
  add column if not exists job_desc_path  text;

-- ---- 0025_candidate_booking.sql ----
-- Interview Manager — candidate self-booking (Google-Calendar style)
-- Run AFTER 0024_booking_form.sql.
--
-- Candidates never read the admin's calendar directly. Two SECURITY DEFINER RPCs:
--   get_booking_availability → anonymized free/blocked time ranges (no names)
--   book_open_slot           → validates + books, guarding against double-booking.

create or replace function public.get_booking_availability(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'repeat_rule', repeat_rule))
      from public.availability_slots where slot_type = 'available'
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'repeat_rule', repeat_rule))
      from public.availability_slots where slot_type in ('busy', 'event')
    ), '[]'::jsonb),
    'taken', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', scheduled_at,
        'ends_at', scheduled_at + make_interval(mins => coalesce(duration_minutes, 30))))
      from public.interview_requests
      where status = 'scheduled' and scheduled_at is not null
        and scheduled_at >= p_from - interval '1 day'
        and scheduled_at <= p_to + interval '1 day'
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.get_booking_availability(timestamptz, timestamptz) to authenticated;

create or replace function public.book_open_slot(
  p_role           text,
  p_starts_at      timestamptz,
  p_duration       integer,
  p_interview_type text default null,
  p_format         text default 'video',
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  dur    integer := greatest(5, least(480, coalesce(p_duration, 30)));
  who    text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_blocked() then raise exception 'Your account is suspended'; end if;
  if coalesce(btrim(p_role), '') = '' then raise exception 'Role is required'; end if;
  if p_starts_at <= now() then raise exception 'Pick a future time'; end if;

  -- Double-booking guard against existing scheduled interviews.
  if exists (
    select 1 from public.interview_requests
    where status = 'scheduled' and scheduled_at is not null
      and tstzrange(scheduled_at, scheduled_at + make_interval(mins => coalesce(duration_minutes, 30)))
          && tstzrange(p_starts_at, p_starts_at + make_interval(mins => dur))
  ) then
    raise exception 'That time was just taken — please pick another.';
  end if;

  insert into public.interview_requests
    (candidate_id, role, interview_type, format, preferred_at, scheduled_at, duration_minutes, notes, status)
  values (auth.uid(), btrim(p_role), p_interview_type, coalesce(p_format, 'video'),
          p_starts_at, p_starts_at, dur, p_notes, 'scheduled')
  returning id into new_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  values (auth.uid(), 'Interview booked',
    'Your interview for "' || btrim(p_role) || '" is booked. We''ll share the details soon.', 'approved');

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'New booking', who || ' booked "' || btrim(p_role) || '"', 'info'
  from public.profiles p where p.role = 'admin';

  return new_id;
end;
$$;
grant execute on function public.book_open_slot(text, timestamptz, integer, text, text, text) to authenticated;

-- ---- 0026_booking_pending.sql ----
-- Interview Manager — calendar bookings are requests (admin-approved)
-- Run AFTER 0025_candidate_booking.sql.
--
-- A candidate can propose ANY time (green slots are only suggestions). Booking
-- creates a PENDING request at their preferred time; the admin approves and
-- confirms it. No auto-schedule, no double-booking block (admins resolve clashes).

create or replace function public.book_open_slot(
  p_role           text,
  p_starts_at      timestamptz,
  p_duration       integer,
  p_interview_type text default null,
  p_format         text default 'video',
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  dur    integer := greatest(5, least(480, coalesce(p_duration, 30)));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_blocked() then raise exception 'Your account is suspended'; end if;
  if coalesce(btrim(p_role), '') = '' then raise exception 'Role is required'; end if;
  if p_starts_at <= now() then raise exception 'Pick a future time'; end if;

  insert into public.interview_requests
    (candidate_id, role, interview_type, format, preferred_at, duration_minutes, notes, status)
  values (auth.uid(), btrim(p_role), p_interview_type, coalesce(p_format, 'video'),
          p_starts_at, dur, p_notes, 'pending')
  returning id into new_id;

  -- Confirm to the candidate. (Admins are already notified by the
  -- notify_admins_new_request trigger that fires on every new request.)
  insert into public.notifications (user_id, title, detail, type)
  values (auth.uid(), 'Request received',
    'Your requested time for "' || btrim(p_role) || '" was sent for approval.', 'info');

  return new_id;
end;
$$;

-- ---- 0027_telegram_for_users.sql ----
-- Interview Manager — Telegram for everyone (candidates + admins)
-- Run AFTER 0026_booking_pending.sql.
--
-- Any signed-in user can connect their own Telegram bot and get their in-app
-- notifications (accepted / rescheduled / declined / …) forwarded to Telegram.
-- Interview reminders stay ADMIN-only.

-- 1) Relax ownership: drop the admin-only requirement (each user owns their row).
drop policy if exists "telegram_owner_all" on public.telegram_settings;
create policy "telegram_owner_all" on public.telegram_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Forward every new notification to that user's Telegram, if connected.
create or replace function public.telegram_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s   public.telegram_settings;
  msg text;
begin
  select * into s from public.telegram_settings where user_id = new.user_id;
  if s.user_id is null or not s.enabled or s.chat_id is null or s.bot_token is null then
    return new;
  end if;

  msg := '🔔 ' || new.title
       || case when coalesce(new.detail, '') <> '' then E'\n' || new.detail else '' end;

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', s.chat_id, 'text', msg, 'disable_web_page_preview', true)
  );
  return new;
end;
$$;

drop trigger if exists on_notification_telegram on public.notifications;
create trigger on_notification_telegram
  after insert on public.notifications
  for each row execute function public.telegram_on_notification();

-- 3) PRIVACY: interview reminders only go to ADMIN owners, so a candidate who
--    connects Telegram never receives reminders about every interview.
create or replace function public.process_interview_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s    record;
  iv   record;
  tz   text;
  msg  text;
  sent integer := 0;
begin
  for s in
    select ts.* from public.telegram_settings ts
    join public.profiles p on p.id = ts.user_id
    where ts.enabled and ts.chat_id is not null and ts.bot_token is not null and p.role = 'admin'
  loop
    for iv in
      select ir.id, ir.role, ir.scheduled_at, ir.meeting_link,
             p.timezone as admin_tz, cp.full_name as cand_name, cp.email as cand_email
      from public.interview_requests ir
      join public.profiles p on p.id = s.user_id
      left join public.profiles cp on cp.id = ir.candidate_id
      where ir.status = 'scheduled' and ir.scheduled_at is not null and ir.scheduled_at > now()
        and ir.scheduled_at <= now() + make_interval(mins => s.reminder_minutes)
        and not exists (
          select 1 from public.reminder_log rl
          where rl.interview_id = ir.id and rl.recipient_id = s.user_id and rl.minutes = s.reminder_minutes
        )
    loop
      tz := coalesce(iv.admin_tz, 'UTC');
      msg := '⏰ Interview reminder' || E'\n'
          || 'Role: ' || iv.role || E'\n'
          || 'Candidate: ' || coalesce(nullif(iv.cand_name, ''), iv.cand_email, 'Unknown') || E'\n'
          || 'When: ' || to_char(iv.scheduled_at at time zone tz, 'Mon DD, HH24:MI') || ' (' || tz || ')'
          || case when iv.meeting_link is not null then E'\n' || 'Link: ' || iv.meeting_link else '' end;

      perform net.http_post(
        url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('chat_id', s.chat_id, 'text', msg, 'disable_web_page_preview', true)
      );
      insert into public.reminder_log (interview_id, recipient_id, minutes) values (iv.id, s.user_id, s.reminder_minutes);
      sent := sent + 1;
    end loop;
  end loop;
  return sent;
end;
$$;
revoke all on function public.process_interview_reminders() from public;
revoke all on function public.process_interview_reminders() from anon;
revoke all on function public.process_interview_reminders() from authenticated;

-- ---- 0028_notify_resilient.sql ----
-- Interview Manager — make notification delivery fault-tolerant
-- Run AFTER 0027_telegram_for_users.sql.
--
-- Telegram/email forwarding must NEVER break the action that created the
-- notification (approve, book, pay…). If pg_net is missing or the provider
-- errors, we swallow it so the notification (and the action) still succeed.

create or replace function public.telegram_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s   public.telegram_settings;
  msg text;
begin
  select * into s from public.telegram_settings where user_id = new.user_id;
  if s.user_id is null or not s.enabled or s.chat_id is null or s.bot_token is null then
    return new;
  end if;

  msg := '🔔 ' || new.title
       || case when coalesce(new.detail, '') <> '' then E'\n' || new.detail else '' end;

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', s.chat_id, 'text', msg, 'disable_web_page_preview', true)
    );
  exception when others then
    null; -- delivery failure / pg_net missing must not block the notification
  end;
  return new;
end;
$$;

create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.app_email_config;
  to_email text;
  html     text;
begin
  select * into cfg from public.app_email_config where id = 1;
  if cfg.id is null or not cfg.enabled or cfg.resend_api_key is null then
    return new;
  end if;

  select email into to_email from public.profiles where id = new.user_id;
  if to_email is null or to_email = '' then
    return new;
  end if;

  html := '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">'
       || '<h2 style="color:#111;font-size:18px">' || new.title || '</h2>'
       || '<p style="color:#444;font-size:14px;line-height:1.6">' || coalesce(new.detail, '') || '</p>'
       || '<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>'
       || '<p style="color:#999;font-size:12px">Interview Scheduler Pro</p></div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || cfg.resend_api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', coalesce(cfg.email_from, 'Interview Scheduler <onboarding@resend.dev>'),
                                 'to', to_email, 'subject', new.title, 'html', html)
    );
  exception when others then
    null; -- delivery failure / pg_net missing must not block the notification
  end;
  return new;
end;
$$;

-- ---- 0029_owner_admin.sql ----
-- Interview Manager — ensure the owner account is an admin
-- Run AFTER 0028_notify_resilient.sql.
--
-- The owner email is admin by app logic (isAdminUser) regardless of role, but
-- set the DB role too so role-filtered queries/triggers (admin notifications,
-- the interviewers list, etc.) include this account. They can still use the
-- candidate side — access to /candidate/* isn't restricted to candidates.

update public.profiles
set role = 'admin'
where lower(email) = 'victorbarbuta54@gmail.com';

-- ---- 0030_reported_amount.sql ----
-- Interview Manager — candidate reports the amount they paid
-- Run AFTER 0029_owner_admin.sql.
--
-- When a candidate says "I've paid", they now enter the dollar amount. We record
-- a PENDING payment (so it shows in Revenue) and notify admins with the amount.

drop function if exists public.notify_payment_sent(uuid);

create or replace function public.notify_payment_sent(
  p_interview_id uuid,
  p_amount       numeric default null,
  p_asset        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.interview_requests;
  who     text;
  amt_txt text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  amt_txt := case when p_amount is not null and p_amount > 0
                  then '$' || trim(to_char(p_amount, 'FM999999990.00'))
                  else 'a payment' end;

  -- Record a pending payment in the ledger (method left null to satisfy the
  -- check constraint; the asset is noted). Admin verifies + marks paid.
  if p_amount is not null and p_amount > 0 then
    insert into public.payments (candidate_id, amount, currency, status, notes)
    values (r.candidate_id, p_amount, 'USD', 'pending',
            'Candidate-reported (' || coalesce(p_asset, 'crypto') || ') for "' || r.role || '"');
  end if;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Payment reported',
    who || ' says they sent ' || amt_txt
      || case when p_asset is not null then ' via ' || p_asset else '' end
      || ' for "' || r.role || '". Please verify and mark it paid.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid, numeric, text) to authenticated;

-- ---- 0031_colors_and_mark_paid.sql ----
-- Interview Manager — per-request color + easier "mark paid"
-- Run AFTER 0030_reported_amount.sql.

-- Custom color for a request/event (chosen by the candidate and/or admin).
alter table public.interview_requests add column if not exists color text;

-- When a candidate reports a payment, record the amount on the interview (if it
-- wasn't invoiced yet) so the admin can just open it and mark it paid — instead
-- of a separate standalone payment row.
create or replace function public.notify_payment_sent(
  p_interview_id uuid,
  p_amount       numeric default null,
  p_asset        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.interview_requests;
  who     text;
  amt_txt text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  amt_txt := case when p_amount is not null and p_amount > 0
                  then '$' || trim(to_char(p_amount, 'FM999999990.00')) else 'a payment' end;

  if p_amount is not null and p_amount > 0 and r.price_cents is null then
    update public.interview_requests set price_cents = round(p_amount * 100) where id = p_interview_id;
  end if;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Payment reported',
    who || ' says they sent ' || amt_txt
      || case when p_asset is not null then ' via ' || p_asset else '' end
      || ' for "' || r.role || '". Open it to verify and mark it paid.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid, numeric, text) to authenticated;

-- ---- 0032_admin_powers_and_outcomes.sql ----
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

-- ---- 0033_checklist_pricing_reschedule_reminders.sql ----
-- Interview Manager — tickable to-do, stage pricing, reschedule proposals, pay reminders
-- Run AFTER 0032_admin_powers_and_outcomes.sql.

-- ============================================================
-- 1) Tickable to-do checklist
--    The admin's action_items are one-per-line; the candidate ticks items off.
--    We store the completed line indices; RLS lets the candidate read the shared
--    row, and a SECURITY DEFINER RPC lets them (only) update their own progress.
-- ============================================================
alter table public.interview_feedback
  add column if not exists action_items_done integer[] not null default '{}';

create or replace function public.set_todo_progress(p_interview_id uuid, p_done integer[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.interview_requests
    where id = p_interview_id and candidate_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;
  update public.interview_feedback
     set action_items_done = coalesce(p_done, '{}'),
         updated_at = now()
   where interview_id = p_interview_id and shared;
end;
$$;
grant execute on function public.set_todo_progress(uuid, integer[]) to authenticated;

-- ============================================================
-- 2) Default price per interview stage/type (one-click invoicing)
-- ============================================================
create table if not exists public.interview_pricing (
  interview_type text primary key,
  price_cents    integer not null check (price_cents >= 0),
  currency       text not null default 'USD',
  updated_at     timestamptz not null default now()
);
alter table public.interview_pricing enable row level security;

drop policy if exists "pricing_admin_all" on public.interview_pricing;
create policy "pricing_admin_all" on public.interview_pricing
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pricing_read_auth" on public.interview_pricing;
create policy "pricing_read_auth" on public.interview_pricing
  for select using (auth.uid() is not null);

-- ============================================================
-- 3) Reschedule proposals — candidate proposes a new time; admin accepts.
-- ============================================================
alter table public.interview_requests
  add column if not exists proposed_at timestamptz;

create or replace function public.propose_reschedule(p_interview_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.interview_requests;
  who text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if p_at <= now() then raise exception 'Pick a future time'; end if;

  update public.interview_requests set proposed_at = p_at where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Reschedule requested',
    who || ' proposed a new time for "' || r.role || '": '
      || to_char(p_at at time zone coalesce(p.timezone, 'UTC'), 'Mon DD, HH24:MI')
      || ' (' || coalesce(p.timezone, 'UTC') || '). Open it to accept.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.propose_reschedule(uuid, timestamptz) to authenticated;

-- ============================================================
-- 4) Payment reminders — nudge candidates with unpaid, invoiced interviews.
--    Idempotent: only re-nudges every 3 days. Call from pg_cron (see bottom).
-- ============================================================
alter table public.interview_requests
  add column if not exists payment_reminder_at timestamptz;

create or replace function public.process_payment_reminders(p_after_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select ir.* from public.interview_requests ir
    where ir.payment_status <> 'paid'
      and ir.price_cents is not null and ir.price_cents > 0
      and ir.status in ('approved', 'scheduled', 'completed')
      and ir.created_at < now() - make_interval(days => p_after_days)
      and (ir.payment_reminder_at is null or ir.payment_reminder_at < now() - interval '3 days')
  loop
    insert into public.notifications (user_id, title, detail, type)
    values (
      r.candidate_id,
      'Payment reminder',
      'A payment is still due for "' || r.role || '". You can pay it anytime from your Payments page.',
      'alert'
    );
    update public.interview_requests set payment_reminder_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.process_payment_reminders(integer) from public;
revoke all on function public.process_payment_reminders(integer) from anon;
revoke all on function public.process_payment_reminders(integer) from authenticated;

-- Auto-schedule a daily 9am sweep if pg_cron is available (no-op otherwise).
do $$
begin
  perform cron.schedule('payment-reminders', '0 9 * * *', 'select public.process_payment_reminders(3);');
exception when others then null;
end $$;
-- Manual equivalent (run once if the block above didn't schedule it):
--   select cron.schedule('payment-reminders', '0 9 * * *',
--     'select public.process_payment_reminders(3);');

-- ---- 0034_reminders_rules_attention.sql ----
-- Interview Manager — candidate reminders, booking rules, "needs attention" flag
-- Run AFTER 0033_checklist_pricing_reschedule_reminders.sql.

-- ============================================================
-- Booking rules (all default 0 = NO restriction; admin opts in).
-- Stored on the single app_settings row; readable by any signed-in user so the
-- candidate booking calendar can enforce them client-side too.
-- ============================================================
alter table public.app_settings add column if not exists min_notice_hours     integer not null default 0;
alter table public.app_settings add column if not exists buffer_minutes        integer not null default 0;
alter table public.app_settings add column if not exists booking_horizon_days  integer not null default 0;

-- ============================================================
-- "Needs attention": flag when a candidate reports a payment so the admin queue
-- can surface it. Redefine notify_payment_sent to stamp it.
-- ============================================================
alter table public.interview_requests add column if not exists payment_reported_at timestamptz;

create or replace function public.notify_payment_sent(
  p_interview_id uuid,
  p_amount       numeric default null,
  p_asset        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.interview_requests;
  who     text;
  amt_txt text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  amt_txt := case when p_amount is not null and p_amount > 0
                  then '$' || trim(to_char(p_amount, 'FM999999990.00')) else 'a payment' end;

  update public.interview_requests
     set payment_reported_at = now(),
         price_cents = case when p_amount is not null and p_amount > 0 and price_cents is null
                            then round(p_amount * 100) else price_cents end
   where id = p_interview_id;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Payment reported',
    who || ' says they sent ' || amt_txt
      || case when p_asset is not null then ' via ' || p_asset else '' end
      || ' for "' || r.role || '". Open it to verify and mark it paid.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid, numeric, text) to authenticated;

-- ============================================================
-- Candidate interview reminders — 24h and 1h before a scheduled interview.
-- In-app notifications (which also forward to Telegram if the candidate is
-- connected). Deduped via reminder_log. Call from pg_cron (see bottom).
-- ============================================================
create or replace function public.process_candidate_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  iv   record;
  tz   text;
  sent integer := 0;
begin
  for iv in
    select ir.id, ir.role, ir.scheduled_at, ir.meeting_link, ir.candidate_id, cp.timezone as cand_tz
    from public.interview_requests ir
    join public.profiles cp on cp.id = ir.candidate_id
    where ir.status = 'scheduled'
      and ir.scheduled_at is not null
      and ir.scheduled_at > now()
      and ir.scheduled_at <= now() + interval '24 hours'
  loop
    tz := coalesce(iv.cand_tz, 'UTC');

    -- 24-hour reminder (fires as soon as the interview is within 24h)
    if not exists (
      select 1 from public.reminder_log
      where interview_id = iv.id and recipient_id = iv.candidate_id and minutes = 1440
    ) then
      insert into public.notifications (user_id, title, detail, type)
      values (iv.candidate_id, 'Interview reminder',
        'Your interview for "' || iv.role || '" is coming up on '
          || to_char(iv.scheduled_at at time zone tz, 'Mon DD, HH24:MI') || ' (' || tz || ').'
          || case when iv.meeting_link is not null then E'\nLink: ' || iv.meeting_link else '' end,
        'info');
      insert into public.reminder_log (interview_id, recipient_id, minutes) values (iv.id, iv.candidate_id, 1440);
      sent := sent + 1;
    end if;

    -- 1-hour reminder
    if iv.scheduled_at <= now() + interval '1 hour' and not exists (
      select 1 from public.reminder_log
      where interview_id = iv.id and recipient_id = iv.candidate_id and minutes = 60
    ) then
      insert into public.notifications (user_id, title, detail, type)
      values (iv.candidate_id, 'Interview starting soon',
        'Your interview for "' || iv.role || '" starts around '
          || to_char(iv.scheduled_at at time zone tz, 'HH24:MI') || ' (' || tz || ').'
          || case when iv.meeting_link is not null then E'\nLink: ' || iv.meeting_link else '' end,
        'alert');
      insert into public.reminder_log (interview_id, recipient_id, minutes) values (iv.id, iv.candidate_id, 60);
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;
revoke all on function public.process_candidate_reminders() from public;
revoke all on function public.process_candidate_reminders() from anon;
revoke all on function public.process_candidate_reminders() from authenticated;

-- Auto-schedule every 15 minutes if pg_cron is available (no-op otherwise).
do $$
begin
  perform cron.schedule('candidate-reminders', '*/15 * * * *', 'select public.process_candidate_reminders();');
exception when others then null;
end $$;
-- Manual equivalent:
--   select cron.schedule('candidate-reminders', '*/15 * * * *',
--     'select public.process_candidate_reminders();');

-- ---- 0035_tg_commands_and_reverse_booking.sql ----
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

