-- ---- 0050_interview_type_styles.sql ----
-- Interview Manager — per-interview-type emoji + color
-- Run AFTER 0049_meeting_completion.sql. Idempotent — safe to re-run.
--
-- Each interview type gets an emoji + color (e.g. Phone screen → 📞 red). The
-- app ships sensible defaults in code; admins can override them (and add custom
-- types) here. Stored app-wide so every calendar/badge — admin and candidate —
-- renders the same. Candidates already read app_settings; admins write it.

alter table public.app_settings
  add column if not exists interview_type_styles jsonb not null default '{}'::jsonb;
