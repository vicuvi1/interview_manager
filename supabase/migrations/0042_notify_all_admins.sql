-- Interview Manager — make sure admins hear about everything (incl. Telegram)
-- Run AFTER 0041_public_booking_antispam.sql.

-- 1) Candidate cancellations now notify admins (previously silent) — so they also
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

  msg := '🔔 ' || new.title
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
