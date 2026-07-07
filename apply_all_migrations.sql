-- ============================================================
-- Interview Manager â€” all migrations, concatenated in order.
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to re-run (idempotent guards throughout).
-- ============================================================

-- ---- 0001_init.sql ----
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

-- ---- 0002_admin.sql ----
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

-- ---- 0003_scheduling.sql ----
-- Interview Manager â€” scheduling (Phase 3)
-- Run AFTER 0002_admin.sql.
--
-- Adds the confirmed time + meeting link the admin sets when scheduling.
-- The 'scheduled' status already exists from 0001; RLS already lets admins
-- update these columns and candidates read them.

alter table public.interview_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists meeting_link text;

-- ---- 0004_payments.sql ----
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

-- ---- 0005_auto_admin.sql ----
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

-- ---- 0006_security.sql ----
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

-- ---- 0007_payments.sql ----
-- Interview Manager â€” payments ledger (Phase 4)
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
-- Interview Manager â€” availability & calendar blocks (Phase 5)
-- Run AFTER 0007_payments.sql.
--
-- One table backs three kinds of admin-managed calendar blocks:
--   available â€” green, bookable windows (candidate booking lands here later)
--   busy      â€” blocked time; candidates can't book over it
--   event     â€” a custom event / manual interview note (optional candidate link)
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
-- Interview Manager â€” private admin notes on candidates (Phase 6)
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
-- Interview Manager â€” notification center support (Phase 7)
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
-- Interview Manager â€” audit log + admin manual controls (Phase 8)
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
      new.role || ': ' || old.status || ' â†’ ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id, 'Rescheduled "' || new.role || '"');
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' â†’ ' || new.payment_status);
  end if;

  return new;
end;
$$;

drop trigger if exists on_interview_audit on public.interview_requests;
create trigger on_interview_audit
  after insert or update on public.interview_requests
  for each row execute function public.log_interview_change();

-- ---- 0012_interviewers.sql ----
-- Interview Manager â€” assigned interviewer (polish pass)
-- Run AFTER 0011_audit_log.sql.
--
-- Each request can be assigned to an interviewer (an admin). Nullable; existing
-- admin select/update RLS already covers reads and writes.

alter table public.interview_requests
  add column if not exists interviewer_id uuid references public.profiles (id) on delete set null;

create index if not exists interview_requests_interviewer_idx
  on public.interview_requests (interviewer_id);

-- ---- 0013_privacy_and_blocking.sql ----
-- Interview Manager â€” privacy hardening + user blocking
-- Run AFTER 0012_interviewers.sql.

-- 1) PRIVACY: candidates must never see each other's data.
--    availability_slots previously allowed any signed-in user to SELECT every
--    row â€” including "event" slots that can reference a specific candidate
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
-- path â€” it verifies is_admin(), logs to the audit trail, and notifies the user.
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
-- Interview Manager â€” Telegram interview reminders
-- Run AFTER 0013_privacy_and_blocking.sql.
--
-- Each admin can connect their own Telegram bot and choose how many minutes
-- before an interview to be reminded. A scheduled job (pg_cron) calls
-- process_interview_reminders() every minute, which sends due reminders via the
-- Telegram Bot API using pg_net.
--
-- ONE-TIME SETUP in Supabase (Dashboard â†’ Database â†’ Extensions, then SQL editor):
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

-- Only the owner (who must be an admin) can see or manage their row â€” this keeps
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
      msg := 'â° Interview reminder' || E'\n'
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
-- Interview Manager â€” richer interview requests + candidate materials
-- Run AFTER 0014_telegram_reminders.sql.
--
-- Candidates can now submit far more context with a request, and keep reusable
-- profile materials (rÃ©sumÃ©, links, phone). The admin reviews it all and
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
-- column allow-list; extend it â€” role/blocked stay ungranted so they can't be
-- self-set.) RLS profiles_update_own still scopes writes to the owner's row.
grant update (phone, linkedin_url, github_url, portfolio_url, resume_url, bio)
  on public.profiles to authenticated;

-- ---- 0016_storage_and_cleanup.sql ----
-- Interview Manager â€” rÃ©sumÃ© uploads + storage/data admin tools
-- Run AFTER 0015_richer_requests.sql.

-- 1) Where an uploaded rÃ©sumÃ© lives (a path inside the private "resumes" bucket).
alter table public.profiles add column if not exists resume_path text;
grant update (resume_path) on public.profiles to authenticated;

-- 2) Private bucket for rÃ©sumÃ©s. Files are namespaced by user id: "<uid>/<file>".
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Candidates manage only their own folder; admins can read every rÃ©sumÃ©.
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
-- Interview Manager â€” interview feedback & outcomes
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
-- Interview Manager â€” email notifications via Resend
-- Run AFTER 0017_interview_feedback.sql.
--
-- Every in-app notification is also emailed to its recipient. Configure the
-- Resend API key + "from" address in Admin â†’ Settings â†’ Email. Requires the
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
-- Interview Manager â€” app settings + automatic data retention
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
-- Interview Manager â€” rÃ©sumÃ© hygiene (free-tier storage control)
-- Run AFTER 0019_app_settings_retention.sql.

-- Admins can delete any rÃ©sumÃ© file (candidates already manage their own folder).
drop policy if exists "resumes_admin_delete" on storage.objects;
create policy "resumes_admin_delete" on storage.objects
  for delete using (bucket_id = 'resumes' and public.is_admin());

-- Admin clears a candidate's rÃ©sumÃ© pointer after removing the file. profiles is
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
-- Interview Manager â€” candidate tags + interview templates (lightweight org tools)
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
-- Interview Manager â€” candidate pipeline stage (HR â†’ Technical â†’ Final)
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
  values (auth.uid(), 'stage', 'user', p_user, who || ' â†’ ' || p_stage);

  insert into public.notifications (user_id, title, detail, type)
  values (
    p_user,
    case when p_stage = 'rejected' then 'Application update' else 'Interview progress' end,
    case when p_stage = 'rejected'
         then 'Thank you for interviewing with us. We won''t be moving forward at this time.'
         when p_stage = 'hired'
         then 'Great news â€” you''ve reached the offer stage!'
         else 'Your application has moved forward.' end,
    case when p_stage = 'rejected' then 'alert' else 'success' end
  );
end;
$$;

grant execute on function public.set_candidate_stage(uuid, text) to authenticated;

-- ---- 0023_payment_wallets.sql ----
-- Interview Manager â€” crypto wallet payments
-- Run AFTER 0022_candidate_stage.sql.
--
-- The admin lists their receiving wallets (USDT/USDC on BEP20/TRC20/etc). A
-- candidate picks one, sees the address, pays externally, and taps "I've paid".
-- The admin verifies and marks it paid. No amount is shown to the candidate, and
-- candidates can no longer self-mark paid.

create table if not exists public.payment_wallets (
  id         uuid primary key default gen_random_uuid(),
  asset      text not null,            -- USDT, USDC, BTC, ETH, BNBâ€¦
  network    text,                     -- BEP20, TRC20, ERC20, SOLâ€¦
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

-- Candidates no longer self-mark paid â€” the admin verifies the transfer.
revoke execute on function public.pay_interview(uuid) from authenticated;

-- ---- 0024_booking_form.sql ----
-- Interview Manager â€” fix audit FK + richer booking fields
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
    values (actor, 'status', 'interview', new.id, new.role || ': ' || old.status || ' â†’ ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id, 'Rescheduled "' || new.role || '"');
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' â†’ ' || new.payment_status);
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
-- Interview Manager â€” candidate self-booking (Google-Calendar style)
-- Run AFTER 0024_booking_form.sql.
--
-- Candidates never read the admin's calendar directly. Two SECURITY DEFINER RPCs:
--   get_booking_availability â†’ anonymized free/blocked time ranges (no names)
--   book_open_slot           â†’ validates + books, guarding against double-booking.

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
    raise exception 'That time was just taken â€” please pick another.';
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
-- Interview Manager â€” calendar bookings are requests (admin-approved)
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
-- Interview Manager â€” Telegram for everyone (candidates + admins)
-- Run AFTER 0026_booking_pending.sql.
--
-- Any signed-in user can connect their own Telegram bot and get their in-app
-- notifications (accepted / rescheduled / declined / â€¦) forwarded to Telegram.
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

  msg := 'ðŸ”” ' || new.title
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
      msg := 'â° Interview reminder' || E'\n'
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
-- Interview Manager â€” make notification delivery fault-tolerant
-- Run AFTER 0027_telegram_for_users.sql.
--
-- Telegram/email forwarding must NEVER break the action that created the
-- notification (approve, book, payâ€¦). If pg_net is missing or the provider
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

  msg := 'ðŸ”” ' || new.title
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
-- Interview Manager â€” ensure the owner account is an admin
-- Run AFTER 0028_notify_resilient.sql.
--
-- The owner email is admin by app logic (isAdminUser) regardless of role, but
-- set the DB role too so role-filtered queries/triggers (admin notifications,
-- the interviewers list, etc.) include this account. They can still use the
-- candidate side â€” access to /candidate/* isn't restricted to candidates.

update public.profiles
set role = 'admin'
where lower(email) = 'victorbarbuta54@gmail.com';

-- ---- 0030_reported_amount.sql ----
-- Interview Manager â€” candidate reports the amount they paid
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
-- Interview Manager â€” per-request color + easier "mark paid"
-- Run AFTER 0030_reported_amount.sql.

-- Custom color for a request/event (chosen by the candidate and/or admin).
alter table public.interview_requests add column if not exists color text;

-- When a candidate reports a payment, record the amount on the interview (if it
-- wasn't invoiced yet) so the admin can just open it and mark it paid â€” instead
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
-- Interview Manager â€” admin powers + richer interview outcomes
-- Run AFTER 0031_colors_and_mark_paid.sql.

-- 1) Admins can DELETE a request (remove it from the approval system entirely).
drop policy if exists "interviews_delete_admin" on public.interview_requests;
create policy "interviews_delete_admin" on public.interview_requests
  for delete using (public.is_admin());

-- 2) Admins can UPDATE any profile â€” so they can rename/relabel users to make
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
-- Interview Manager â€” tickable to-do, stage pricing, reschedule proposals, pay reminders
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
-- 3) Reschedule proposals â€” candidate proposes a new time; admin accepts.
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
-- 4) Payment reminders â€” nudge candidates with unpaid, invoiced interviews.
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
-- Interview Manager â€” candidate reminders, booking rules, "needs attention" flag
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
-- Candidate interview reminders â€” 24h and 1h before a scheduled interview.
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
-- Interview Manager â€” two-way Telegram commands + candidate-shared availability
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

-- ---- 0036_payment_hidden.sql ----
-- Interview Manager â€” soft-hide settled invoices from the Payments board
-- Run AFTER 0035_tg_commands_and_reverse_booking.sql.
--
-- A paid invoice can be hidden from the "Recently paid" list to tidy the board,
-- WITHOUT deleting it â€” revenue history and KPIs still count it.

alter table public.interview_requests
  add column if not exists payment_hidden boolean not null default false;

-- ---- 0037_public_booking_and_digest.sql ----
-- Interview Manager â€” public booking link + admin daily digest
-- Run AFTER 0036_payment_hidden.sql.

-- ============================================================
-- Public booking: anyone (no account) can submit a request. Lands as a "lead"
-- the admin reviews and optionally converts into a real interview.
-- ============================================================
create table if not exists public.public_booking_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  role         text not null,
  preferred_at timestamptz,
  timezone     text,
  notes        text,
  status       text not null default 'new' check (status in ('new', 'converted', 'dismissed')),
  created_at   timestamptz not null default now()
);
create index if not exists public_booking_requests_status_idx
  on public.public_booking_requests (status, created_at desc);

alter table public.public_booking_requests enable row level security;

-- Anyone (including anonymous visitors) may submit.
drop policy if exists "pbr_insert_anyone" on public.public_booking_requests;
create policy "pbr_insert_anyone" on public.public_booking_requests
  for insert to anon, authenticated with check (true);

-- Only admins can read / manage the leads.
drop policy if exists "pbr_admin_all" on public.public_booking_requests;
create policy "pbr_admin_all" on public.public_booking_requests
  for all using (public.is_admin()) with check (public.is_admin());

grant insert on public.public_booking_requests to anon, authenticated;
grant select, update, delete on public.public_booking_requests to authenticated;

-- Notify admins (and forward to Telegram) when a public request comes in.
create or replace function public.notify_admins_public_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'New booking request',
    new.name || ' requested "' || new.role || '"'
      || case when new.email is not null then ' â€” ' || new.email else '' end,
    'info'
  from public.profiles p where p.role = 'admin';
  return new;
end;
$$;

drop trigger if exists on_public_request_notify on public.public_booking_requests;
create trigger on_public_request_notify
  after insert on public.public_booking_requests
  for each row execute function public.notify_admins_public_request();

alter table public.public_booking_requests replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.public_booking_requests;
exception when duplicate_object then null; end $$;

-- ============================================================
-- Admin daily digest â€” a morning summary notification (also forwards to Telegram).
-- ============================================================
create or replace function public.process_admin_digest()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today_iv integer;
  pending  integer;
  unpaid   integer;
  resched  integer;
  a        record;
  n        integer := 0;
begin
  select count(*) into today_iv from public.interview_requests
    where status = 'scheduled'
      and scheduled_at >= date_trunc('day', now())
      and scheduled_at <  date_trunc('day', now()) + interval '1 day';
  select count(*) into pending from public.interview_requests where status = 'pending';
  select count(*) into unpaid  from public.interview_requests where payment_status <> 'paid' and price_cents is not null;
  select count(*) into resched from public.interview_requests where proposed_at is not null;

  for a in select id from public.profiles where role = 'admin' loop
    insert into public.notifications (user_id, title, detail, type)
    values (a.id, 'Daily summary',
      today_iv || ' interview(s) today Â· ' || pending || ' pending Â· '
        || unpaid || ' unpaid Â· ' || resched || ' reschedule request(s).',
      'info');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.process_admin_digest() from public;
revoke all on function public.process_admin_digest() from anon;
revoke all on function public.process_admin_digest() from authenticated;

-- Auto-schedule a daily 8am digest if pg_cron is available (no-op otherwise).
do $$
begin
  perform cron.schedule('admin-digest', '0 8 * * *', 'select public.process_admin_digest();');
exception when others then null;
end $$;

-- ---- 0038_app_feedback.sql ----
-- Interview Manager â€” in-app feedback (bug reports / feature ideas from candidates)
-- Run AFTER 0037_public_booking_and_digest.sql.
--
-- Candidates submit feedback; admins get a notification (which forwards to their
-- Telegram) carrying the person's name + message.

create table if not exists public.app_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  name       text,
  email      text,
  category   text not null default 'idea' check (category in ('bug', 'idea', 'other')),
  message    text not null,
  status     text not null default 'new' check (status in ('new', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);

alter table public.app_feedback enable row level security;

-- Signed-in users can submit their own feedback.
drop policy if exists "feedback_insert_own" on public.app_feedback;
create policy "feedback_insert_own" on public.app_feedback
  for insert to authenticated with check (auth.uid() = user_id);

-- Users can read their own; admins can read/manage everything.
drop policy if exists "feedback_read_own" on public.app_feedback;
create policy "feedback_read_own" on public.app_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "feedback_admin_all" on public.app_feedback;
create policy "feedback_admin_all" on public.app_feedback
  for all using (public.is_admin()) with check (public.is_admin());

grant insert, select on public.app_feedback to authenticated;

-- Notify admins (and forward to Telegram) with the name + message.
create or replace function public.notify_admins_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who   text;
  title text;
begin
  who := coalesce(nullif(new.name, ''), new.email, 'A user');
  title := case new.category
             when 'bug' then 'ðŸ› Bug report'
             when 'idea' then 'ðŸ’¡ Feature idea'
             else 'ðŸ“© New feedback'
           end;
  insert into public.notifications (user_id, title, detail, type)
  select p.id, title,
    'From ' || who
      || case when new.email is not null and new.email <> '' then ' (' || new.email || ')' else '' end
      || E'\n' || new.message,
    'info'
  from public.profiles p where p.role = 'admin';
  return new;
end;
$$;

drop trigger if exists on_feedback_notify on public.app_feedback;
create trigger on_feedback_notify
  after insert on public.app_feedback
  for each row execute function public.notify_admins_feedback();

alter table public.app_feedback replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.app_feedback;
exception when duplicate_object then null; end $$;

-- ---- 0039_user_calendar_color.sql ----
-- Interview Manager â€” per-user calendar color (Google-Calendar style calendar list)
-- Run AFTER 0038_app_feedback.sql.
--
-- The admin can assign each candidate a color; their interviews render in that
-- color on the admin calendar. (Admins can already update profiles via 0032.)

alter table public.profiles add column if not exists calendar_color text;

-- ---- 0040_reconcile_and_resilience.sql ----
-- Interview Manager â€” payment reconciliation + email resilience
-- Run AFTER 0039_user_calendar_color.sql.

-- ============================================================
-- 1) Reconcile the payments ledger with interview_requests, the source of truth:
--    * removing an invoice (price_cents â†’ null) now DELETES the synced ledger row
--      (manual standalone payments have interview_id = null and are untouched)
--    * marking an interview unpaid reverts the ledger row to pending + clears paid_at
-- ============================================================
create or replace function public.sync_payment_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price_cents is null then
    delete from public.payments where interview_id = new.id;
    return new;
  end if;

  insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at)
  values (
    new.id,
    new.candidate_id,
    (new.price_cents::numeric / 100.0),
    coalesce(new.currency, 'USD'),
    case when new.payment_status = 'paid' then 'paid' else 'pending' end,
    case when new.payment_status = 'paid' then new.paid_at else null end
  )
  on conflict (interview_id) where interview_id is not null do update set
    amount   = excluded.amount,
    currency = excluded.currency,
    status   = case when new.payment_status = 'paid' then 'paid' else 'pending' end,
    paid_at  = case when new.payment_status = 'paid' then new.paid_at else null end,
    updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2) Email resilience: never let a Resend/pg_net hiccup roll back the
--    notification insert (and the action that triggered it).
-- ============================================================
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
  exception when others then
    null; -- pg_net missing or errored â€” deliver in-app anyway
  end;

  return new;
end;
$$;

-- ---- 0041_public_booking_antispam.sql ----
-- Interview Manager â€” anti-spam for the public booking link
-- Run AFTER 0040_reconcile_and_resilience.sql.
--
-- Locks down direct anonymous inserts and routes everything through a vetted
-- SECURITY DEFINER RPC that validates input and rate-limits per IP.

alter table public.public_booking_requests add column if not exists ip_hash text;

-- No more direct anon/authenticated inserts â€” the RPC below is the only way in.
drop policy if exists "pbr_insert_anyone" on public.public_booking_requests;
revoke insert on public.public_booking_requests from anon;
revoke insert on public.public_booking_requests from authenticated;

create or replace function public.submit_public_booking(
  p_name         text,
  p_email        text,
  p_role         text,
  p_preferred_at timestamptz default null,
  p_timezone     text default null,
  p_notes        text default null,
  p_ip_hash      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  -- Basic validation (server-side, not bypassable by a crafted client).
  if length(coalesce(btrim(p_name), '')) < 2 then raise exception 'INVALID_NAME'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if length(coalesce(btrim(p_role), '')) < 2 then raise exception 'INVALID_ROLE'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'INVALID_NOTES'; end if;

  -- Rate limit: at most 5 submissions per IP per hour.
  if p_ip_hash is not null then
    select count(*) into recent
    from public.public_booking_requests
    where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if recent >= 5 then raise exception 'RATE_LIMIT'; end if;
  end if;

  insert into public.public_booking_requests (name, email, role, preferred_at, timezone, notes, ip_hash)
  values (
    btrim(p_name),
    lower(btrim(p_email)),
    btrim(p_role),
    p_preferred_at,
    p_timezone,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_ip_hash
  );
end;
$$;

revoke all on function public.submit_public_booking(text, text, text, timestamptz, text, text, text) from public;
grant execute on function public.submit_public_booking(text, text, text, timestamptz, text, text, text) to anon, authenticated;

-- ---- 0042_notify_all_admins.sql ----
-- Interview Manager â€” make sure admins hear about everything (incl. Telegram)
-- Run AFTER 0041_public_booking_antispam.sql.

-- 1) Candidate cancellations now notify admins (previously silent) â€” so they also
--    forward to Telegram like every other notification.
create or replace function public.cancel_my_request(p_interview_id uuid)
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
  if r.status not in ('pending', 'approved', 'scheduled') then
    raise exception 'This request can no longer be cancelled';
  end if;

  update public.interview_requests set status = 'cancelled' where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview cancelled', who || ' cancelled "' || r.role || '"', 'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.cancel_my_request(uuid) to authenticated;

-- 2) Re-assert the "forward EVERY notification to Telegram" trigger, resiliently,
--    so a stale/missing version can't stop payment/booking/etc. messages.
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

  msg := 'ðŸ”” ' || new.title
       || case when coalesce(new.detail, '') <> '' then E'\n' || new.detail else '' end;

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', s.chat_id, 'text', msg, 'disable_web_page_preview', true)
    );
  exception when others then
    null; -- never let a Telegram hiccup roll back the notification
  end;
  return new;
end;
$$;

drop trigger if exists on_notification_telegram on public.notifications;
create trigger on_notification_telegram
  after insert on public.notifications
  for each row execute function public.telegram_on_notification();

-- ---- 0043_request_field_config.sql ----
-- Interview Manager â€” admin-configurable request-form fields
-- Run AFTER 0042_notify_all_admins.sql.
--
-- The admin decides, per field, whether it's required / optional / hidden on the
-- candidate request form. Stored as { "<field>": "required|optional|hidden" }.
-- Candidates can already read app_settings (app_settings_read), admins write it.

alter table public.app_settings add column if not exists request_fields jsonb not null default '{}'::jsonb;

-- ---- 0044_notification_selftest.sql ----
-- Interview Manager â€” end-to-end notification self-test
-- Run AFTER 0043_request_field_config.sql.
--
-- Inserts a notification for the caller, which exercises the full pipeline:
-- in-app bell + the Telegram-forward trigger + the email trigger. If it reaches
-- Telegram/email, notifications work end-to-end.

create or replace function public.send_self_test_notification()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.notifications (user_id, title, detail, type)
  values (
    auth.uid(),
    'Test notification',
    'If this reached your Telegram (and email, if set up), notifications are working end-to-end.',
    'info'
  );
end;
$$;
grant execute on function public.send_self_test_notification() to authenticated;

-- ---- 0045_telegram_diagnostics.sql ----
-- Interview Manager â€” Telegram pipeline self-diagnosis
-- Run AFTER 0044_notification_selftest.sql. Idempotent â€” safe to re-run.
--
-- Real event notifications forward to Telegram from the DATABASE via pg_net
-- (the `telegram_on_notification` trigger). The in-app "Send test" button only
-- checks the bot from the Next.js server, so it can pass while real messages
-- never arrive (e.g. pg_net not enabled). This function reports the health of
-- the whole pipeline for the calling user so the cause is obvious.

create or replace function public.telegram_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid            uuid := auth.uid();
  s              public.telegram_settings;
  has_pgnet      boolean := false;
  has_pgcron     boolean := false;
  has_trigger    boolean := false;
  cron_scheduled boolean := false;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  select * into s from public.telegram_settings where user_id = uid;

  -- Extensions that the forwarding + reminder jobs depend on.
  select exists(select 1 from pg_extension where extname = 'pg_net')  into has_pgnet;
  select exists(select 1 from pg_extension where extname = 'pg_cron') into has_pgcron;

  -- Is the "forward every notification to Telegram" trigger installed?
  select exists(
    select 1 from pg_trigger
    where tgname = 'on_notification_telegram' and not tgisinternal
  ) into has_trigger;

  -- Is the every-minute reminder job scheduled? (cron.job only exists with pg_cron)
  if has_pgcron then
    begin
      execute 'select exists(select 1 from cron.job where jobname = ''interview-reminders'')'
        into cron_scheduled;
    exception when others then
      cron_scheduled := false;
    end;
  end if;

  return jsonb_build_object(
    'pg_net_enabled',      has_pgnet,
    'pg_cron_enabled',     has_pgcron,
    'forward_trigger',     has_trigger,
    'reminders_scheduled', cron_scheduled,
    'has_settings',        s.user_id is not null,
    'enabled',             coalesce(s.enabled, false),
    'has_token',           s.bot_token is not null,
    'has_chat',            s.chat_id is not null,
    'bot_username',        s.bot_username
  );
end;
$$;

grant execute on function public.telegram_diagnostics() to authenticated;

-- ---- 0046_per_user_email_prefs.sql ----
-- Interview Manager â€” per-user email notification preferences
-- Run AFTER 0045_telegram_diagnostics.sql. Idempotent â€” safe to re-run.
--
-- Until now email forwarding was all-or-nothing (global app_email_config) and
-- always went to the account email. Users can now choose whether to also get
-- their notifications by email, and send them to their login email or a
-- different address.

-- 1) Preference columns on the user's own profile.
alter table public.profiles
  add column if not exists notify_email_enabled boolean not null default true;
alter table public.profiles
  add column if not exists notify_email text;

-- Let each user manage their own preference from the app. The column-level grant
-- keeps role/etc. locked; profiles_update_own RLS still restricts it to their row.
grant update (notify_email_enabled, notify_email) on public.profiles to authenticated;

-- 2) The email-forward trigger now respects the per-user toggle + custom address.
create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg          public.app_email_config;
  acct_email   text;
  custom_email text;
  email_on     boolean;
  to_email     text;
  html         text;
begin
  select * into cfg from public.app_email_config where id = 1;
  if cfg.id is null or not cfg.enabled or cfg.resend_api_key is null then
    return new;
  end if;

  select email, notify_email, notify_email_enabled
    into acct_email, custom_email, email_on
    from public.profiles where id = new.user_id;

  if not coalesce(email_on, true) then
    return new; -- user turned email notifications off
  end if;

  -- A custom address wins; otherwise fall back to the account email.
  to_email := coalesce(nullif(trim(custom_email), ''), acct_email);
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
  exception when others then
    null; -- pg_net missing or errored â€” deliver in-app anyway
  end;

  return new;
end;
$$;

-- ---- 0047_booking_profiles.sql ----
-- Interview Manager â€” reusable "person" profiles for the booking form
-- Run AFTER 0046_per_user_email_prefs.sql. Idempotent â€” safe to re-run.
--
-- Lets a user save the repeating details for a person (name, resume, portfolio,
-- LinkedIn, GitHub, phone) under a label ("Steven", "Braden", â€¦) and one-click
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

-- ---- 0048_resume_library.sql ----
-- Interview Manager â€” reusable rÃ©sumÃ© library
-- Run AFTER 0047_booking_profiles.sql. Idempotent â€” safe to re-run.
--
-- Instead of re-uploading a rÃ©sumÃ© on every booking, users add named rÃ©sumÃ©s
-- once (Settings â†’ RÃ©sumÃ©s) â€” "Resume 1", "Frontend CV", â€¦ â€” and pick one from
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

-- ---- 0049_meeting_completion.sql ----
-- Interview Manager â€” post-meeting summary the admin sends on completion
-- Run AFTER 0048_resume_library.sql. Idempotent â€” safe to re-run.
--
-- When an admin marks an interview completed they can send the candidate the
-- meeting URL (a link only â€” no video), how long the meeting actually lasted,
-- and optional notes. Stored on the request so it also shows on the candidate's
-- interview; the existing notification triggers forward it to Telegram/email.

alter table public.interview_requests
  add column if not exists recording_url    text;
alter table public.interview_requests
  add column if not exists actual_minutes   integer;
alter table public.interview_requests
  add column if not exists completion_notes text;
alter table public.interview_requests
  add column if not exists completed_at     timestamptz;

-- ---- 0050_interview_type_styles.sql ----
-- Interview Manager â€” per-interview-type emoji + color
-- Run AFTER 0049_meeting_completion.sql. Idempotent â€” safe to re-run.
--
-- Each interview type gets an emoji + color (e.g. Phone screen â†’ ðŸ“ž red). The
-- app ships sensible defaults in code; admins can override them (and add custom
-- types) here. Stored app-wide so every calendar/badge â€” admin and candidate â€”
-- renders the same. Candidates already read app_settings; admins write it.

alter table public.app_settings
  add column if not exists interview_type_styles jsonb not null default '{}'::jsonb;

-- ---- 0051_candidate_meeting_link.sql ----
-- Interview Manager â€” let a candidate set/edit their own meeting link
-- Run AFTER 0050_interview_type_styles.sql. Idempotent â€” safe to re-run.
--
-- Candidates can add a meeting link at booking (insert), but RLS blocks them from
-- updating a request afterwards. This SECURITY DEFINER RPC lets a candidate set or
-- change the meeting link on their OWN interview later, and notifies admins (which
-- forwards to Telegram/email) so they get the link right away.

create or replace function public.set_my_meeting_link(p_interview_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
  link text := nullif(trim(p_url), '');
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set meeting_link = link where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Meeting link updated',
    who || ' set the meeting link for "' || r.role || '"'
      || case when link is not null then ': ' || link else ' (removed it)' end,
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.set_my_meeting_link(uuid, text) to authenticated;

-- ---- 0052_google_calendar_sync.sql ----
-- Interview Manager â€” two-way Google Calendar sync (multi-account) + drag support
-- Run AFTER 0051_candidate_meeting_link.sql. Idempotent â€” safe to re-run.
--
-- Design (kept lean for the free Supabase plan â€” we store IDs/tokens/sync
-- cursors only, never event bodies):
--  * google_accounts   â€” per-user OAuth accounts (MANY per user). Tokens are a
--                        per-user secret: owner-only RLS, NEVER selected to the
--                        browser (mirrors telegram_settings).
--  * google_calendars  â€” calendars under each account; `selected` to sync, one
--                        `is_push_target` per user (where new events are created);
--                        `sync_token` is the incremental-pull cursor.
--  * google_event_linksâ€” interview_id <-> (calendar, google_event_id) map + etag.
--  * google_sync_jobs  â€” outbound queue (no FK on interview_id so delete jobs
--                        outlive a hard-deleted interview). Hardened: attempts
--                        cap + dead-letter + stale-'processing' reaper.
--  * google_sync_configâ€” single admin row: base_url + push_secret for pg_net.
--
-- PULL is cron-poll only (no events.watch webhook: Google requires a verified
-- callback domain, which *.vercel.app cannot provide). pg_cron hits /api/google/sync
-- every minute; a "Sync now" button and google_diagnostics() are the fallbacks.

-- === google_accounts (per-user OAuth secret; MANY per user) ===
create table if not exists public.google_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  google_sub       text not null,
  email            text,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  scopes           text,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists google_accounts_user_sub_uidx on public.google_accounts (user_id, google_sub);
create index if not exists google_accounts_user_idx on public.google_accounts (user_id, created_at desc);
alter table public.google_accounts enable row level security;
drop policy if exists "google_accounts_owner_all" on public.google_accounts;
create policy "google_accounts_owner_all" on public.google_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Column lockdown: RLS is row-level, so ALSO forbid the client role from reading
-- the token columns (defense-in-depth â€” tokens are only ever read server-side via
-- the service-role client). Mirrors the 0006 profiles column grant.
revoke select on public.google_accounts from anon, authenticated;
grant select (id, user_id, google_sub, email, enabled, token_expires_at, scopes, created_at, updated_at)
  on public.google_accounts to authenticated;

-- === google_calendars (MANY per account; one push target per user) ===
create table if not exists public.google_calendars (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.google_accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  google_calendar_id text not null,
  summary            text,
  time_zone          text,
  access_role        text,
  selected           boolean not null default false,
  is_push_target     boolean not null default false,
  sync_token         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists google_calendars_cal_uidx on public.google_calendars (account_id, google_calendar_id);
create index if not exists google_calendars_user_idx on public.google_calendars (user_id);
-- Exactly one push target per user:
create unique index if not exists google_calendars_one_push_target_uidx on public.google_calendars (user_id) where is_push_target;
alter table public.google_calendars enable row level security;
drop policy if exists "google_calendars_owner_all" on public.google_calendars;
create policy "google_calendars_owner_all" on public.google_calendars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- === google_event_links (interview <-> event map, per calendar) ===
create table if not exists public.google_event_links (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  interview_id    uuid not null references public.interview_requests(id) on delete cascade,
  calendar_id     uuid not null references public.google_calendars(id) on delete cascade,
  google_event_id text not null,
  html_link       text,
  etag            text,
  sync_status     text not null default 'synced' check (sync_status in ('synced','pending','error','deleted')),
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists google_event_links_interview_cal_uidx on public.google_event_links (interview_id, calendar_id);
create unique index if not exists google_event_links_cal_event_uidx on public.google_event_links (calendar_id, google_event_id);
create index if not exists google_event_links_interview_idx on public.google_event_links (interview_id);
alter table public.google_event_links enable row level security;
drop policy if exists "google_event_links_owner_all" on public.google_event_links;
create policy "google_event_links_owner_all" on public.google_event_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "google_event_links_admin_select" on public.google_event_links;
create policy "google_event_links_admin_select" on public.google_event_links
  for select using (public.is_admin());

-- === google_sync_jobs (outbound queue; NO FK so delete jobs survive) ===
create table if not exists public.google_sync_jobs (
  id           bigint generated always as identity primary key,
  interview_id uuid,                        -- intentionally no FK: must outlive a hard-deleted interview
  op           text not null check (op in ('upsert','delete')),
  reason       text,
  payload      jsonb,                        -- delete snapshot: [{calendar_id, google_event_id}]
  status       text not null default 'pending' check (status in ('pending','processing','done','error','failed')),
  attempts     int not null default 0,
  last_error   text,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists google_sync_jobs_pending_idx on public.google_sync_jobs (status, created_at) where status in ('pending','error');
alter table public.google_sync_jobs enable row level security;
-- RLS on, NO policy => denied to anon/authenticated. Drained by service_role only.

-- === google_sync_config (admin-set base_url + shared secret for pg_net) ===
create table if not exists public.google_sync_config (
  id          boolean primary key default true check (id),
  base_url    text,
  push_secret text,   -- MUST equal the CRON_SECRET env var (kept in two places, like ADMIN_EMAIL)
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.google_sync_config (id) values (true) on conflict (id) do nothing;
alter table public.google_sync_config enable row level security;
drop policy if exists "google_sync_config_admin_all" on public.google_sync_config;
create policy "google_sync_config_admin_all" on public.google_sync_config
  for all using (public.is_admin()) with check (public.is_admin());

-- === PUSH trigger: BEFORE ins/upd/del, loop-guarded, enqueue + best-effort nudge ===
-- BEFORE (not AFTER) so a hard DELETE can still snapshot google_event_links
-- (which cascade-delete with the parent) into the job payload.
create or replace function public.google_sync_on_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_event  boolean;
  v_was_event boolean;
  v_enqueue   text := null;   -- 'upsert' | 'delete' | null
  v_payload   jsonb := null;
  v_cfg       public.google_sync_config;
begin
  -- Loop guard: pull-originated writes set this transaction-local GUC, so we
  -- never bounce a Google-originated change back to Google.
  if coalesce(current_setting('app.google_sync', true), '') = 'on' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.status = 'scheduled' and OLD.scheduled_at is not null then
      v_enqueue := 'delete';
    end if;
  elsif TG_OP = 'INSERT' then
    if NEW.status = 'scheduled' and NEW.scheduled_at is not null then
      v_enqueue := 'upsert';
    end if;
  else -- UPDATE
    v_is_event  := NEW.status = 'scheduled' and NEW.scheduled_at is not null;
    v_was_event := OLD.status = 'scheduled' and OLD.scheduled_at is not null;
    if v_is_event and not v_was_event then
      v_enqueue := 'upsert';
    elsif v_was_event and not v_is_event then
      v_enqueue := 'delete';                       -- cancelled/rejected OR reverted to pending/approved
    elsif v_is_event and v_was_event then
      -- Only fields the Google event actually renders (NOT color: Google uses a
      -- fixed colorId enum, so an app color tag would churn attendees for nothing).
      if NEW.scheduled_at     is distinct from OLD.scheduled_at
      or NEW.duration_minutes is distinct from OLD.duration_minutes
      or NEW.meeting_link     is distinct from OLD.meeting_link
      or NEW.interviewer_id   is distinct from OLD.interviewer_id
      or NEW.role             is distinct from OLD.role
      or NEW.notes            is distinct from OLD.notes
      or NEW.interview_type   is distinct from OLD.interview_type then
        v_enqueue := 'upsert';
      end if;
    end if;
  end if;

  if v_enqueue = 'delete' then
    select jsonb_agg(jsonb_build_object('calendar_id', l.calendar_id, 'google_event_id', l.google_event_id))
      into v_payload
      from public.google_event_links l
     where l.interview_id = coalesce(OLD.id, NEW.id)
       and l.sync_status <> 'deleted';
  end if;

  if v_enqueue is not null then
    insert into public.google_sync_jobs (interview_id, op, reason, payload)
    values (coalesce(NEW.id, OLD.id), v_enqueue, TG_OP || ':' || coalesce(v_enqueue,''), v_payload);

    -- Best-effort nudge so sync happens in seconds. Swallow ALL errors so a
    -- pg_net/config problem never blocks the interview write (telegram pattern).
    begin
      select * into v_cfg from public.google_sync_config where id = true;
      if v_cfg.enabled and v_cfg.base_url is not null then
        perform net.http_post(
          url     := v_cfg.base_url || '/api/google/sync',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_cfg.push_secret,'')),
          body    := jsonb_build_object('source','nudge')
        );
      end if;
    exception when others then null;
    end;
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end$$;

drop trigger if exists on_interview_google_sync on public.interview_requests;
create trigger on_interview_google_sync
  before insert or update or delete on public.interview_requests
  for each row execute function public.google_sync_on_interview_change();

-- === PULL apply (service-role only): loop-guarded writer used by the sync route ===
create or replace function public.google_apply_pull(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_cancel boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Suppress the push trigger for THIS transaction (no bounce back to Google).
  perform set_config('app.google_sync', 'on', true);
  if p_cancel then
    update public.interview_requests
       set status = 'cancelled'
     where id = p_interview_id and status = 'scheduled';
  else
    update public.interview_requests
       set scheduled_at     = coalesce(p_scheduled_at, scheduled_at),
           duration_minutes = coalesce(p_duration_minutes, duration_minutes)
     where id = p_interview_id and status = 'scheduled';
  end if;
end$$;
revoke all on function public.google_apply_pull(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.google_apply_pull(uuid, timestamptz, integer, boolean) to service_role;

-- === Atomic job claim: reaper for stale 'processing', dead-letter, bounded batch ===
create or replace function public.google_claim_sync_jobs(p_limit int default 10)
returns setof public.google_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Requeue jobs whose drain crashed / hit the Vercel timeout (stuck > 5 min);
  -- if they've already used all their attempts, dead-letter instead of requeuing
  -- (otherwise a 5th-attempt timeout would wedge the job in 'pending' forever).
  update public.google_sync_jobs
     set status = case when attempts >= 5 then 'failed' else 'pending' end
   where status = 'processing' and claimed_at < now() - interval '5 minutes';
  -- Dead-letter jobs that keep failing so they stop hammering Google every minute.
  update public.google_sync_jobs
     set status = 'failed'
   where status = 'error' and attempts >= 5;
  return query
  update public.google_sync_jobs j
     set status = 'processing', attempts = attempts + 1, claimed_at = now()
   where j.id in (
     select id from public.google_sync_jobs
      where status in ('pending','error') and attempts < 5
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end$$;
revoke all on function public.google_claim_sync_jobs(int) from public, anon, authenticated;
grant execute on function public.google_claim_sync_jobs(int) to service_role;

-- === Diagnostics (mirrors telegram_diagnostics) ===
create or replace function public.google_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_scheduled boolean := false;
begin
  begin
    select exists(select 1 from cron.job where jobname = 'google-calendar-sync') into v_scheduled;
  exception when others then v_scheduled := false;
  end;
  return jsonb_build_object(
    'pg_net_enabled',  exists(select 1 from pg_extension where extname = 'pg_net'),
    'pg_cron_enabled', exists(select 1 from pg_extension where extname = 'pg_cron'),
    'sync_scheduled',  v_scheduled,
    'pending_jobs',    (select count(*) from public.google_sync_jobs where status in ('pending','error')),
    'failed_jobs',     (select count(*) from public.google_sync_jobs where status = 'failed'),
    'base_url_set',    coalesce((select base_url is not null from public.google_sync_config where id = true), false),
    'secret_set',      coalesce((select push_secret is not null from public.google_sync_config where id = true), false)
  );
end$$;
grant execute on function public.google_diagnostics() to authenticated;

-- === Self-schedule the drain/pull cron (no-op if pg_cron absent) ===
do $$ begin
  perform cron.schedule('google-calendar-sync', '* * * * *', $cron$
    select net.http_post(
      url     := (select base_url from public.google_sync_config where id = true and base_url is not null) || '/api/google/sync',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-sync-secret', (select coalesce(push_secret,'') from public.google_sync_config where id = true)),
      body    := jsonb_build_object('source','cron')
    )
    where exists (select 1 from public.google_sync_config where id = true and enabled and base_url is not null);
  $cron$);
exception when others then null;
end $$;
-- ---- end 0052_google_calendar_sync.sql ----

-- ---- 0053_busy_override_request.sql ----
-- Interview Manager â€” "ask about a busy time" requests
-- Run AFTER 0052_google_calendar_sync.sql. Idempotent â€” safe to re-run.
--
-- A candidate can request a time the admin marked BUSY/blocked. It's a normal
-- interview request flagged busy_override=true; admins get a distinct "exception
-- request" notification and Approve (schedule at that time â€” it becomes a meeting
-- block) or Reject as usual. One flag column; no new tables (free plan).

alter table public.interview_requests
  add column if not exists busy_override boolean not null default false;

-- Word the admin notification specially for busy-time requests (per-admin timezone).
create or replace function public.notify_admins_new_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  a   record;
begin
  select coalesce(nullif(cp.full_name, ''), cp.email, 'A candidate') into who
  from public.profiles cp where cp.id = new.candidate_id;

  if new.busy_override then
    for a in select id, coalesce(timezone, 'UTC') as tz from public.profiles where role = 'admin' loop
      insert into public.notifications (user_id, title, detail, type)
      values (
        a.id,
        'Busy-time request',
        who || ' asked to book "' || new.role || '" at '
          || to_char(coalesce(new.preferred_at, now()) at time zone a.tz, 'Mon DD, HH24:MI')
          || ' (' || a.tz || ') â€” a time you marked busy. Approve to schedule it, or reject.',
        'alert'
      );
    end loop;
  else
    insert into public.notifications (user_id, title, detail, type)
    select p.id, 'New interview request', who || ' requested "' || new.role || '"', 'info'
    from public.profiles p where p.role = 'admin';
  end if;
  return new;
end;
$$;

-- ---- 0054_booking_privacy.sql ----
-- Interview Manager â€” booking privacy hardening
-- Run AFTER 0053_busy_override_request.sql.
--
-- Candidates must only see other users' times as anonymous "busy" blocks â€” never
-- names, emails, or roles. Admin-accepted requests (approved with a time, or
-- scheduled) block the slot for everyone else.

-- Belt-and-suspenders: candidates must not read availability_slots directly.
drop policy if exists "availability_select_auth" on public.availability_slots;

create or replace function public.get_booking_availability(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return (
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
          'starts_at', slot_at,
          'ends_at', slot_at + make_interval(mins => coalesce(duration_minutes, 30))))
        from (
          select
            coalesce(scheduled_at, preferred_at) as slot_at,
            duration_minutes
          from public.interview_requests
          where candidate_id is distinct from auth.uid()
            and (
              (status = 'scheduled' and scheduled_at is not null)
              or (status = 'approved' and preferred_at is not null)
            )
            and coalesce(scheduled_at, preferred_at) >= p_from - interval '1 day'
            and coalesce(scheduled_at, preferred_at) <= p_to + interval '1 day'
        ) blocked
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_booking_availability(timestamptz, timestamptz) to authenticated;

-- ---- 0055_edit_interview.sql ----
-- Interview Manager â€” candidates edit their interview anytime + edit tracking
-- Run AFTER 0054_booking_privacy.sql. Idempotent â€” safe to re-run.
--
-- Candidates can update key fields of their OWN interview at any time (even after
-- it's scheduled). RLS blocks direct updates, so this SECURITY DEFINER RPC does it,
-- stamps last_edited_at/by, and notifies admins (which forwards to Telegram/email).

alter table public.interview_requests add column if not exists last_edited_at timestamptz;
alter table public.interview_requests add column if not exists last_edited_by uuid references auth.users(id) on delete set null;

create or replace function public.edit_my_interview(
  p_interview_id uuid,
  p_role         text default null,
  p_notes        text default null,
  p_meeting_link text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set
    role         = coalesce(nullif(trim(p_role), ''), role),          -- role can't be blanked
    notes        = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    meeting_link = case when p_meeting_link is null then meeting_link else nullif(trim(p_meeting_link), '') end,
    last_edited_at = now(),
    last_edited_by = auth.uid()
  where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview details edited',
    who || ' updated the details for "' || (select role from public.interview_requests where id = p_interview_id) || '".',
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.edit_my_interview(uuid, text, text, text) to authenticated;

-- ---- 0056_reminders_cron_and_versioning.sql ----
-- Interview Manager â€” auto-schedule Telegram reminders + app-version broadcast
-- Run AFTER 0055_edit_interview.sql. Idempotent â€” safe to re-run.
--
-- 1) The interview reminder cron was previously only documented (manual SQL), so
--    reminders never fired unless someone ran it. Self-schedule it (no-op if
--    pg_cron is absent), mirroring the google-calendar-sync job. NOTE: reminders
--    AND immediate confirmations still require the pg_net extension to be enabled
--    (Supabase â†’ Database â†’ Extensions) â€” the in-app "Send test" bypasses pg_net,
--    which is why it can work while real messages don't.
do $$ begin
  perform cron.schedule('interview-reminders', '* * * * *', $cron$ select public.process_interview_reminders(); $cron$);
exception when others then null;
end $$;

-- 2) A version token admins can bump to make every open client show an
--    "Update now" banner (force-reload to the latest deploy).
alter table public.app_settings add column if not exists app_version text;

-- Broadcast app_settings changes over Realtime so the banner appears instantly.
do $$ begin
  alter publication supabase_realtime add table public.app_settings;
exception when others then null;
end $$;

-- ---- 0057_interview_attachments.sql ----
-- Interview Manager â€” file/image attachments on an interview
-- Run AFTER 0056_reminders_cron_and_versioning.sql. Idempotent â€” safe to re-run.
--
-- Files live in the existing private "resumes" bucket (owner read/write, admin
-- read). We store only { name, path } refs here â€” no blobs (free plan).

alter table public.interview_requests
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Extend edit_my_interview so candidates can also add/remove attachments later.
drop function if exists public.edit_my_interview(uuid, text, text, text);
create or replace function public.edit_my_interview(
  p_interview_id uuid,
  p_role         text  default null,
  p_notes        text  default null,
  p_meeting_link text  default null,
  p_attachments  jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set
    role         = coalesce(nullif(trim(p_role), ''), role),
    notes        = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    meeting_link = case when p_meeting_link is null then meeting_link else nullif(trim(p_meeting_link), '') end,
    attachments  = coalesce(p_attachments, attachments),
    last_edited_at = now(),
    last_edited_by = auth.uid()
  where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview details edited',
    who || ' updated the details for "' || (select role from public.interview_requests where id = p_interview_id) || '".',
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.edit_my_interview(uuid, text, text, text, jsonb) to authenticated;

-- ---- 0058_admin_notes.sql ----
-- Interview Manager â€” private per-interview notes only admins can see
-- Run AFTER 0057_interview_attachments.sql. Idempotent â€” safe to re-run.
--
-- Kept in a SEPARATE table (not a column on interview_requests) because
-- candidates can read their own interview row â€” a column there would leak to
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

-- ---- 0059_history_meeting_link.sql ----
-- Interview Manager â€” record the time & meeting link the admin sends, in history
-- Run AFTER 0058_admin_notes.sql. Idempotent â€” safe to re-run.
--
-- log_interview_change() already records created/status/reschedule/payment into
-- audit_log. This adds the actual scheduled TIME and MEETING LINK to the trail so
-- an admin can always see (and keep) exactly what was sent to the candidate. The
-- Manage dialog surfaces these audit rows as a per-interview History.

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
      new.role || ': ' || old.status || ' â†’ ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id,
      'Time set to ' || to_char(new.scheduled_at at time zone 'UTC', 'Mon DD, HH24:MI') || ' UTC');
  end if;

  if new.meeting_link is distinct from old.meeting_link then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'meeting_link', 'interview', new.id,
      case when new.meeting_link is not null and new.meeting_link <> ''
           then 'Meeting link set: ' || new.meeting_link
           else 'Meeting link removed' end);
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' â†’ ' || new.payment_status);
  end if;

  return new;
end;
$$;

-- ---- 0060_schedule_rpc.sql ----
-- Interview Manager â€” server-side scheduling with conflict detection.
-- Run AFTER 0059_history_meeting_link.sql. Idempotent â€” safe to re-run.
--
-- Until now every admin "schedule" / "reschedule" / "book" action wrote to
-- interview_requests directly from the browser, gated only by RLS. The overlap
-- check lived purely in the UI grid, so two admins (or one racing themselves, a
-- calendar drag, an accepted reschedule proposal, or a direct API call) could
-- double-book one interviewer onto one time slot.
--
-- These SECURITY DEFINER functions make the database the source of truth. A
-- shared helper takes a per-interviewer transaction lock (so concurrent
-- schedulers are serialized) and rejects any time overlapping another SCHEDULED
-- interview for the same interviewer. schedule_interview() updates an existing
-- request; book_interview() inserts a brand-new already-scheduled one. Callers
-- still send their own candidate notification, so wording/format is unchanged,
-- and the audit-log trigger on interview_requests records the change.

-- Overlap guard shared by both RPCs. NOT granted to `authenticated`: it is only
-- ever called from the two SECURITY DEFINER functions below (which run as the
-- owner and may call it), never directly from the client.
create or replace function public.assert_slot_free(
  p_exclude_id  uuid,        -- interview to ignore (the one being (re)scheduled), or null
  p_at          timestamptz,
  p_duration    integer,
  p_interviewer uuid         -- null = the shared/unassigned calendar
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict public.interview_requests;
begin
  -- Serialize scheduling for this interviewer/calendar so the check below can't
  -- be defeated by two concurrent transactions both seeing the slot as free.
  -- The advisory lock is released automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('schedule:' || coalesce(p_interviewer::text, 'unassigned'), 0)
  );

  -- Any other scheduled interview for the same interviewer whose range
  -- [start, start + duration) overlaps [p_at, p_at + p_duration) is a conflict.
  select * into conflict
  from public.interview_requests o
  where (p_exclude_id is null or o.id <> p_exclude_id)
    and o.status = 'scheduled'
    and o.scheduled_at is not null
    and o.interviewer_id is not distinct from p_interviewer
    and o.scheduled_at < p_at + make_interval(mins => p_duration)
    and o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > p_at
  order by o.scheduled_at
  limit 1;

  if found then
    raise exception 'That time overlaps another scheduled interview ("%" at %). Pick a different slot.',
      conflict.role, to_char(conflict.scheduled_at, 'Mon DD HH24:MI');
  end if;
end;
$$;

-- Schedule / reschedule an EXISTING request.
create or replace function public.schedule_interview(
  p_interview_id   uuid,
  p_scheduled_at   timestamptz,
  p_duration       integer default null,   -- null keeps the existing duration
  p_meeting_link   text    default null,   -- null keeps existing, '' clears, else sets
  p_interviewer_id uuid    default null    -- authoritative: null means "unassigned"
) returns public.interview_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.interview_requests;
  v_dur integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_scheduled_at is null then raise exception 'Pick a time'; end if;
  if p_scheduled_at <= now() then raise exception 'Pick a future time'; end if;

  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;

  v_dur := greatest(coalesce(p_duration, r.duration_minutes, 30), 1);
  perform public.assert_slot_free(p_interview_id, p_scheduled_at, v_dur, p_interviewer_id);

  update public.interview_requests set
    scheduled_at     = p_scheduled_at,
    duration_minutes = v_dur,
    meeting_link     = case when p_meeting_link is null then meeting_link
                            else nullif(trim(p_meeting_link), '') end,
    interviewer_id   = p_interviewer_id,
    proposed_at      = null,
    status           = 'scheduled'
  where id = p_interview_id
  returning * into r;

  return r;
end;
$$;

-- Create a NEW already-scheduled request (admin books on a candidate's behalf).
create or replace function public.book_interview(
  p_candidate_id   uuid,
  p_role           text,
  p_scheduled_at   timestamptz,
  p_duration       integer default 30,
  p_meeting_link   text    default null,
  p_interviewer_id uuid    default null,
  p_interview_type text    default null,
  p_level          text    default null,
  p_format         text    default null
) returns public.interview_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.interview_requests;
  v_dur integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_candidate_id is null then raise exception 'Select a candidate'; end if;
  if coalesce(trim(p_role), '') = '' then raise exception 'Enter a role'; end if;
  if p_scheduled_at is null then raise exception 'Pick a time'; end if;
  if p_scheduled_at <= now() then raise exception 'Pick a future time'; end if;

  v_dur := greatest(coalesce(p_duration, 30), 1);
  perform public.assert_slot_free(null, p_scheduled_at, v_dur, p_interviewer_id);

  insert into public.interview_requests (
    candidate_id, role, interview_type, level, format,
    preferred_at, scheduled_at, duration_minutes, meeting_link,
    interviewer_id, status, payment_status, currency
  ) values (
    p_candidate_id, trim(p_role), nullif(p_interview_type, ''), nullif(p_level, ''), nullif(p_format, ''),
    p_scheduled_at, p_scheduled_at, v_dur, nullif(trim(p_meeting_link), ''),
    p_interviewer_id, 'scheduled', 'unpaid', 'USD'
  )
  returning * into r;

  return r;
end;
$$;

grant execute on function public.schedule_interview(uuid, timestamptz, integer, text, uuid) to authenticated;
grant execute on function public.book_interview(uuid, text, timestamptz, integer, text, uuid, text, text, text) to authenticated;

-- ---- 0061_calendar_color_grant.sql ----
-- Interview Manager â€” let the calendar_color column actually be written.
-- Run AFTER 0060_schedule_rpc.sql. Idempotent â€” safe to re-run.
--
-- 0039 added profiles.calendar_color and 0032 gave admins a row-level UPDATE
-- policy, but 0006 had revoked blanket UPDATE on profiles in favour of explicit
-- column grants (full_name, email, timezone; later resume_path, email prefs).
-- calendar_color was never added to that grant list, so setting a person's
-- calendar colour was rejected at the column-privilege level â€” the write failed
-- silently and the colour reverted on the next refetch/reload.
--
-- Granting UPDATE on just this column lets it be written. Which ROWS a user may
-- update is still governed by RLS: profiles_update_own (their own row) and
-- profiles_update_admin (admins â†’ any row), so admins can colour any candidate.

grant update (calendar_color) on public.profiles to authenticated;

-- ---- 0062_self_service_booking.sql ----
-- Interview Manager â€” true self-service booking (Calendly-style).
-- Run AFTER 0061_calendar_color_grant.sql. Idempotent â€” safe to re-run.
--
-- Until now, picking a green "Available" time on the candidate calendar still
-- only created a PENDING request the admin had to confirm by hand. This adds a
-- candidate-callable RPC that, when the chosen time really is inside published
-- availability (no busy/booked conflict) and passes the booking rules, flips the
-- request straight to `scheduled` â€” no admin step. If the slot isn't actually
-- open (race, rules, outside availability) it returns false and the request just
-- stays pending, so the old request-and-wait path is the graceful fallback.
--
-- The recurrence math mirrors the client's lib/slots.ts expandRecurring exactly:
-- occurrences repeat FORWARD from the anchor only (k >= 0), by a fixed 1-day /
-- 7-day millisecond step (DST-naive, but consistent with what the UI draws).

-- Does a (possibly recurring) slot [a_s, a_e) fully COVER the target [t_s, t_e)?
create or replace function public.slot_covers(
  a_s timestamptz, a_e timestamptz, rule text, t_s timestamptz, t_e timestamptz
) returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  step_s double precision;
  dur_s  double precision := extract(epoch from (a_e - a_s));
  k      bigint;
  i      int;
  occ_s  timestamptz;
begin
  if rule not in ('daily', 'weekly') then
    return a_s <= t_s and a_e >= t_e;
  end if;
  step_s := case when rule = 'daily' then 86400 else 604800 end;
  k := floor(extract(epoch from (t_s - a_s)) / step_s);
  for i in -1..1 loop
    if (k + i) < 0 then continue; end if;                 -- no backward recurrence
    occ_s := a_s + make_interval(secs => (k + i) * step_s);
    if occ_s <= t_s and (occ_s + make_interval(secs => dur_s)) >= t_e then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Does a (possibly recurring) slot [a_s, a_e) OVERLAP the target [t_s, t_e)?
create or replace function public.slot_overlaps_target(
  a_s timestamptz, a_e timestamptz, rule text, t_s timestamptz, t_e timestamptz
) returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  step_s double precision;
  dur_s  double precision := extract(epoch from (a_e - a_s));
  k      bigint;
  i      int;
  occ_s  timestamptz;
begin
  if rule not in ('daily', 'weekly') then
    return a_s < t_e and a_e > t_s;
  end if;
  step_s := case when rule = 'daily' then 86400 else 604800 end;
  k := floor(extract(epoch from (t_s - a_s)) / step_s);
  for i in -1..1 loop
    if (k + i) < 0 then continue; end if;
    occ_s := a_s + make_interval(secs => (k + i) * step_s);
    if occ_s < t_e and (occ_s + make_interval(secs => dur_s)) > t_s then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Confirm a pending request instantly IF its time is genuinely open. Returns
-- true when it was scheduled, false when it wasn't eligible (left pending).
create or replace function public.book_available_slot(p_interview_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.interview_requests;
  t_s        timestamptz;
  t_e        timestamptz;
  min_notice int;
  horizon    int;
  cand_tz    text;
  cand_name  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if r.status <> 'pending' then return false; end if;   -- only auto-confirm fresh requests
  if coalesce(r.busy_override, false) then return false; end if; -- exceptions need an admin

  t_s := coalesce(r.scheduled_at, r.preferred_at);
  if t_s is null or t_s <= now() then return false; end if;
  t_e := t_s + make_interval(mins => coalesce(r.duration_minutes, 30));

  -- Booking rules (same fields the client checks).
  select coalesce(min_notice_hours, 0), coalesce(booking_horizon_days, 0)
    into min_notice, horizon
  from public.app_settings where id = 1;
  if min_notice > 0 and t_s < now() + make_interval(hours => min_notice) then return false; end if;
  if horizon > 0 and t_s > now() + make_interval(days => horizon) then return false; end if;

  -- Serialize bookings so two candidates can't grab the same slot at once.
  perform pg_advisory_xact_lock(hashtextextended('booking:global', 0));

  -- Must fall inside a published available window â€¦
  if not exists (
    select 1 from public.availability_slots
    where slot_type = 'available'
      and public.slot_covers(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- â€¦ and not collide with a busy/event block â€¦
  if exists (
    select 1 from public.availability_slots
    where slot_type in ('busy', 'event')
      and public.slot_overlaps_target(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- â€¦ or another candidate's confirmed/accepted interview.
  if exists (
    select 1 from public.interview_requests o
    where o.id <> r.id
      and o.candidate_id is distinct from r.candidate_id
      and (
        (o.status = 'scheduled' and o.scheduled_at is not null
          and o.scheduled_at < t_e
          and o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
        or (o.status = 'approved' and o.preferred_at is not null
          and o.preferred_at < t_e
          and o.preferred_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
      )
  ) then
    return false;
  end if;

  -- Open â€” confirm it.
  update public.interview_requests
    set status = 'scheduled',
        scheduled_at = t_s,
        meeting_link = coalesce(meeting_link, 'https://meet.jit.si/InterviewPro-' || replace(r.id::text, '-', ''))
    where id = r.id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into cand_name
    from public.profiles where id = r.candidate_id;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview booked',
    cand_name || ' booked "' || r.role || '" for '
      || to_char(t_s at time zone coalesce(p.timezone, 'UTC'), 'Mon DD, HH24:MI')
      || ' (' || coalesce(p.timezone, 'UTC') || ').',
    'approved'
  from public.profiles p where p.role = 'admin';

  select coalesce(timezone, 'UTC') into cand_tz from public.profiles where id = r.candidate_id;
  insert into public.notifications (user_id, title, detail, type)
  values (r.candidate_id, 'Interview confirmed',
    'Your interview for "' || r.role || '" is booked for '
      || to_char(t_s at time zone cand_tz, 'Mon DD, HH24:MI') || ' (' || cand_tz || ').',
    'approved');

  return true;
end;
$$;

grant execute on function public.book_available_slot(uuid) to authenticated;

-- ---- 0063_configurable_durations.sql ----
-- Interview Manager â€” configurable duration options + per-type default duration.
-- Run AFTER 0062_self_service_booking.sql. Idempotent â€” safe to re-run.
--
-- Durations were a hard-coded 15/30/45/60/90 dropdown in four places, and every
-- interview type defaulted to 30 min. These two settings let admins choose which
-- durations are offered and give each interview type its own default, so the
-- right length is pre-selected when a candidate (or admin) picks that type.
--
-- app_settings is gated by RLS (app_settings_read for all, app_settings_admin_write
-- for admins) with table-level grants â€” NOT the profiles-style column-grant model â€”
-- so new columns are writable by admins without any extra grant.

alter table public.app_settings
  add column if not exists duration_options integer[] not null default '{15,30,45,60,90}';

-- Map of interview_type -> default minutes, e.g. {"Technical": 60, "Screening": 30}.
alter table public.app_settings
  add column if not exists type_durations jsonb not null default '{}'::jsonb;

-- ---- 0064_status_customization.sql ----
-- Interview Manager â€” admin-customizable status labels & colors.
-- Run AFTER 0063_configurable_durations.sql. Idempotent â€” safe to re-run.
--
-- The interview status keys (pending/approved/scheduled/completed/rejected/
-- cancelled) stay fixed in the DB, but admins can now relabel and recolor how
-- they DISPLAY â€” e.g. "pending" â†’ "Awaiting confirmation" in a brand color â€”
-- across badges and the calendar legend. Stored as keyâ†’string / keyâ†’hex maps.
-- app_settings is RLS-gated with table-level grants, so no column grant needed.

alter table public.app_settings
  add column if not exists status_labels jsonb not null default '{}'::jsonb;

alter table public.app_settings
  add column if not exists status_colors jsonb not null default '{}'::jsonb;


-- ---- 0065_edit_interview_type_duration.sql ----
-- Interview Manager — candidates can also edit interview type & duration
-- Run AFTER 0064_status_customization.sql. Idempotent — safe to re-run.
--
-- Extends edit_my_interview (0055 + 0057) so a candidate can change the
-- interview type and duration too, alongside role / notes / link / attachments.
-- Still SECURITY DEFINER (RLS blocks direct candidate updates), still stamps
-- last_edited_at/by and notifies admins. New params are optional/defaulted so
-- existing callers keep working.

drop function if exists public.edit_my_interview(uuid, text, text, text, jsonb);
create or replace function public.edit_my_interview(
  p_interview_id   uuid,
  p_role           text    default null,
  p_notes          text    default null,
  p_meeting_link   text    default null,
  p_attachments    jsonb   default null,
  p_interview_type text    default null,
  p_duration       integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set
    role           = coalesce(nullif(trim(p_role), ''), role),
    notes          = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    meeting_link   = case when p_meeting_link is null then meeting_link else nullif(trim(p_meeting_link), '') end,
    attachments    = coalesce(p_attachments, attachments),
    interview_type = case when p_interview_type is null then interview_type else nullif(trim(p_interview_type), '') end,
    -- CHECK constraint keeps duration in [5, 480]; clamp defensively.
    duration_minutes = case when p_duration is null then duration_minutes else greatest(5, least(480, p_duration)) end,
    last_edited_at = now(),
    last_edited_by = auth.uid()
  where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview details edited',
    who || ' updated the details for "' || (select role from public.interview_requests where id = p_interview_id) || '".',
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.edit_my_interview(uuid, text, text, text, jsonb, text, integer) to authenticated;


-- ---- 0066_telegram_formatting.sql ----
-- Interview Manager — cleaner, correctly-encoded Telegram notifications
-- Run AFTER 0065_edit_interview_type_duration.sql. Idempotent — safe to re-run.
--
-- Fixes the garbled emoji prefix (a literal emoji in an earlier migration was
-- stored as mojibake, showing up as "ðŸ""" in Telegram) and organizes each
-- message: a per-type icon, a bold title, then the detail on its own line —
-- using Telegram HTML formatting. Emojis are built from numeric code points via
-- chr() so they can't be corrupted by the file/client encoding again, and the
-- request is sent as explicit UTF-8.

create or replace function public.telegram_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.telegram_settings;
  icon  text;
  title text;
  body  text;
  msg   text;
begin
  select * into s from public.telegram_settings where user_id = new.user_id;
  if s.user_id is null or not s.enabled or s.chat_id is null or s.bot_token is null then
    return new;
  end if;

  -- Per-type icon (numeric code points — encoding-proof).
  icon := case new.type
            when 'approved' then chr(9989)     -- ✅
            when 'success'  then chr(127881)   -- 🎉
            when 'rejected' then chr(10060)    -- ❌
            when 'alert'    then chr(9888)     -- ⚠
            else                 chr(128276)   -- 🔔  (info / default)
          end;

  -- HTML-escape user-supplied text so parse_mode=HTML can't break on & < >.
  title := replace(replace(replace(coalesce(new.title, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  body  := replace(replace(replace(coalesce(new.detail, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  msg := icon || ' <b>' || title || '</b>'
       || case when body <> '' then E'\n' || body else '' end;

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json; charset=utf-8'),
      body := jsonb_build_object(
        'chat_id', s.chat_id,
        'text', msg,
        'parse_mode', 'HTML',
        'disable_web_page_preview', true
      )
    );
  exception when others then
    null; -- never let a Telegram hiccup roll back the notification
  end;
  return new;
end;
$$;

drop trigger if exists on_notification_telegram on public.notifications;
create trigger on_notification_telegram
  after insert on public.notifications
  for each row execute function public.telegram_on_notification();


-- ---- 0067_interview_materials_and_sent.sql ----
-- Interview Manager — per-interview materials snapshot + "details sent" stamp
-- Run AFTER 0066_telegram_formatting.sql. Idempotent — safe to re-run.
--
-- (1) Snapshot the candidate's materials onto the interview at request time so
--     the admin can see exactly which résumé / links were submitted FOR THIS
--     interview (they used to live only on the mutable profile).
-- (2) Record when the admin last sent the meeting details, so the UI can show
--     "details sent 2m ago" and avoid double-sends.

alter table public.interview_requests add column if not exists resume_path     text;
alter table public.interview_requests add column if not exists resume_url      text;
alter table public.interview_requests add column if not exists portfolio_url   text;
alter table public.interview_requests add column if not exists linkedin_url    text;
alter table public.interview_requests add column if not exists github_url      text;
alter table public.interview_requests add column if not exists applicant_phone text;
alter table public.interview_requests add column if not exists details_sent_at timestamptz;


-- ---- 0068_ics_feed.sql ----
-- Interview Manager — per-candidate .ics calendar subscription feed
-- Run AFTER 0067_interview_materials_and_sent.sql. Idempotent — safe to re-run.
--
-- Gives each candidate a secret token; a public /api/calendar?token=… endpoint
-- serves their scheduled interviews as a live .ics feed so they auto-appear in
-- Google/Apple/Outlook. The read RPC is SECURITY DEFINER + token-scoped so the
-- endpoint needs no login (calendar apps can't authenticate).

alter table public.profiles add column if not exists ics_token text;
create unique index if not exists profiles_ics_token_key
  on public.profiles(ics_token) where ics_token is not null;

-- Generate (once) and return the current user's feed token.
create or replace function public.ensure_ics_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  select ics_token into t from public.profiles where id = auth.uid();
  if t is null or t = '' then
    t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.profiles set ics_token = t where id = auth.uid();
  end if;
  return t;
end;
$$;
grant execute on function public.ensure_ics_token() to authenticated;

-- Token-scoped read of a candidate's upcoming/scheduled interviews for the feed.
create or replace function public.ics_feed(p_token text)
returns table (id uuid, role text, scheduled_at timestamptz, duration_minutes integer, meeting_link text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.role, r.scheduled_at, r.duration_minutes, r.meeting_link
  from public.interview_requests r
  join public.profiles p on p.id = r.candidate_id
  where p_token is not null
    and length(p_token) >= 16
    and p.ics_token = p_token
    and r.status = 'scheduled'
    and r.scheduled_at is not null
  order by r.scheduled_at;
$$;
grant execute on function public.ics_feed(text) to anon, authenticated;


-- ---- 0069_self_serve_reschedule.sql ----
-- Interview Manager — candidate self-serve reschedule into an open slot
-- Run AFTER 0068_ics_feed.sql. Idempotent — safe to re-run.
--
-- Lets a candidate move their OWN approved/scheduled interview to a new time
-- INSTANTLY when that time is genuinely inside published availability (no
-- busy/event/other-candidate conflict) and passes the booking rules. Mirrors
-- book_available_slot's validation exactly. Returns false when the time isn't
-- open — the client then falls back to propose_reschedule (admin confirms), so
-- a candidate can never silently grab an unavailable time.

create or replace function public.reschedule_to_open_slot(p_interview_id uuid, p_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.interview_requests;
  t_s        timestamptz := p_at;
  t_e        timestamptz;
  min_notice int;
  horizon    int;
  cand_tz    text;
  cand_name  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if r.status not in ('approved', 'scheduled') then return false; end if;
  if coalesce(r.busy_override, false) then return false; end if;

  if t_s is null or t_s <= now() then return false; end if;
  t_e := t_s + make_interval(mins => coalesce(r.duration_minutes, 30));

  select coalesce(min_notice_hours, 0), coalesce(booking_horizon_days, 0)
    into min_notice, horizon
  from public.app_settings where id = 1;
  if min_notice > 0 and t_s < now() + make_interval(hours => min_notice) then return false; end if;
  if horizon > 0 and t_s > now() + make_interval(days => horizon) then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('booking:global', 0));

  -- Inside a published available window …
  if not exists (
    select 1 from public.availability_slots
    where slot_type = 'available'
      and public.slot_covers(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- … not colliding with a busy/event block …
  if exists (
    select 1 from public.availability_slots
    where slot_type in ('busy', 'event')
      and public.slot_overlaps_target(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- … or another candidate's confirmed/accepted interview.
  if exists (
    select 1 from public.interview_requests o
    where o.id <> r.id
      and o.candidate_id is distinct from r.candidate_id
      and (
        (o.status = 'scheduled' and o.scheduled_at is not null
          and o.scheduled_at < t_e
          and o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
        or (o.status = 'approved' and o.preferred_at is not null
          and o.preferred_at < t_e
          and o.preferred_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
      )
  ) then
    return false;
  end if;

  -- Open — move it and confirm.
  update public.interview_requests
    set status = 'scheduled',
        scheduled_at = t_s,
        proposed_at = null,
        meeting_link = coalesce(meeting_link, 'https://meet.jit.si/InterviewPro-' || replace(r.id::text, '-', ''))
    where id = r.id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into cand_name
    from public.profiles where id = r.candidate_id;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview rescheduled',
    cand_name || ' moved "' || r.role || '" to '
      || to_char(t_s at time zone coalesce(p.timezone, 'UTC'), 'Mon DD, HH24:MI')
      || ' (' || coalesce(p.timezone, 'UTC') || ').',
    'approved'
  from public.profiles p where p.role = 'admin';

  select coalesce(timezone, 'UTC') into cand_tz from public.profiles where id = r.candidate_id;
  insert into public.notifications (user_id, title, detail, type)
  values (r.candidate_id, 'Interview rescheduled',
    'Your interview for "' || r.role || '" is now booked for '
      || to_char(t_s at time zone cand_tz, 'Mon DD, HH24:MI') || ' (' || cand_tz || ').',
    'approved');

  return true;
end;
$$;

grant execute on function public.reschedule_to_open_slot(uuid, timestamptz) to authenticated;


-- ---- 0070_company_name.sql ----
-- Interview Manager — company name on an interview request
-- Run AFTER 0069_self_serve_reschedule.sql. Idempotent — safe to re-run.
--
-- Candidates can name the company an interview is for. It's a plain nullable
-- column governed by the existing row RLS (interview_requests has table-level
-- grants, so no per-column grant is needed — unlike profiles). Search stays
-- client-side over already-fetched rows and also scans the free-text fields, so
-- no index or RPC is required here.

alter table public.interview_requests add column if not exists company text;
