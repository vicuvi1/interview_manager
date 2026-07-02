-- Interview Manager — public booking link + admin daily digest
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
      || case when new.email is not null then ' — ' || new.email else '' end,
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
-- Admin daily digest — a morning summary notification (also forwards to Telegram).
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
      today_iv || ' interview(s) today · ' || pending || ' pending · '
        || unpaid || ' unpaid · ' || resched || ' reschedule request(s).',
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
