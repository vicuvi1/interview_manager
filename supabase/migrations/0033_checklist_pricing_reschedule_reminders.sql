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
