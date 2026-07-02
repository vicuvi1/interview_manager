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
