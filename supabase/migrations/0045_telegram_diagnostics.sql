-- ---- 0045_telegram_diagnostics.sql ----
-- Interview Manager — Telegram pipeline self-diagnosis
-- Run AFTER 0044_notification_selftest.sql. Idempotent — safe to re-run.
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
