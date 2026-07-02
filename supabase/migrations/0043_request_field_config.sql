-- Interview Manager — admin-configurable request-form fields
-- Run AFTER 0042_notify_all_admins.sql.
--
-- The admin decides, per field, whether it's required / optional / hidden on the
-- candidate request form. Stored as { "<field>": "required|optional|hidden" }.
-- Candidates can already read app_settings (app_settings_read), admins write it.

alter table public.app_settings add column if not exists request_fields jsonb not null default '{}'::jsonb;
