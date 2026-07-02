-- Interview Manager — per-user calendar color (Google-Calendar style calendar list)
-- Run AFTER 0038_app_feedback.sql.
--
-- The admin can assign each candidate a color; their interviews render in that
-- color on the admin calendar. (Admins can already update profiles via 0032.)

alter table public.profiles add column if not exists calendar_color text;
