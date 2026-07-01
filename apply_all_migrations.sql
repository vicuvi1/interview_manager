-- ================================================================
-- supabase/migrations/0001_init.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0002_admin.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0003_scheduling.sql
-- ================================================================
-- Interview Manager — scheduling (Phase 3)
-- Run AFTER 0002_admin.sql.
--
-- Adds the confirmed time + meeting link the admin sets when scheduling.
-- The 'scheduled' status already exists from 0001; RLS already lets admins
-- update these columns and candidates read them.

alter table public.interview_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists meeting_link text;

-- ================================================================
-- supabase/migrations/0004_payments.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0005_auto_admin.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0006_security.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0007_payments.sql
-- ================================================================
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
on conflict (interview_id) do nothing;

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
    on conflict (interview_id) do update set
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

-- ================================================================
-- supabase/migrations/0008_availability.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0009_candidate_notes.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0010_notifications_center.sql
-- ================================================================
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

-- ================================================================
-- supabase/migrations/0011_audit_log.sql
-- ================================================================
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

