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
