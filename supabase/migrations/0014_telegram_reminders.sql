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
