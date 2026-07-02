-- Interview Manager — end-to-end notification self-test
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
