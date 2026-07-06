-- ---- 0056_reminders_cron_and_versioning.sql ----
-- Interview Manager — auto-schedule Telegram reminders + app-version broadcast
-- Run AFTER 0055_edit_interview.sql. Idempotent — safe to re-run.
--
-- 1) The interview reminder cron was previously only documented (manual SQL), so
--    reminders never fired unless someone ran it. Self-schedule it (no-op if
--    pg_cron is absent), mirroring the google-calendar-sync job. NOTE: reminders
--    AND immediate confirmations still require the pg_net extension to be enabled
--    (Supabase → Database → Extensions) — the in-app "Send test" bypasses pg_net,
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
