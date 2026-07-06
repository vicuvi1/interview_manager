-- ---- 0063_configurable_durations.sql ----
-- Interview Manager — configurable duration options + per-type default duration.
-- Run AFTER 0062_self_service_booking.sql. Idempotent — safe to re-run.
--
-- Durations were a hard-coded 15/30/45/60/90 dropdown in four places, and every
-- interview type defaulted to 30 min. These two settings let admins choose which
-- durations are offered and give each interview type its own default, so the
-- right length is pre-selected when a candidate (or admin) picks that type.
--
-- app_settings is gated by RLS (app_settings_read for all, app_settings_admin_write
-- for admins) with table-level grants — NOT the profiles-style column-grant model —
-- so new columns are writable by admins without any extra grant.

alter table public.app_settings
  add column if not exists duration_options integer[] not null default '{15,30,45,60,90}';

-- Map of interview_type -> default minutes, e.g. {"Technical": 60, "Screening": 30}.
alter table public.app_settings
  add column if not exists type_durations jsonb not null default '{}'::jsonb;
