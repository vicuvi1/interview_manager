-- ---- 0064_status_customization.sql ----
-- Interview Manager — admin-customizable status labels & colors.
-- Run AFTER 0063_configurable_durations.sql. Idempotent — safe to re-run.
--
-- The interview status keys (pending/approved/scheduled/completed/rejected/
-- cancelled) stay fixed in the DB, but admins can now relabel and recolor how
-- they DISPLAY — e.g. "pending" → "Awaiting confirmation" in a brand color —
-- across badges and the calendar legend. Stored as key→string / key→hex maps.
-- app_settings is RLS-gated with table-level grants, so no column grant needed.

alter table public.app_settings
  add column if not exists status_labels jsonb not null default '{}'::jsonb;

alter table public.app_settings
  add column if not exists status_colors jsonb not null default '{}'::jsonb;
