-- Interview Manager — app settings + automatic data retention
-- Run AFTER 0018_email_notifications.sql.
--
-- Free-tier friendly: a scheduled job trims old rows so the database doesn't creep
-- toward the 500 MB limit. Schedule it with pg_cron (see note at the bottom).

create table if not exists public.app_settings (
  id                     integer primary key default 1 check (id = 1),
  retention_enabled      boolean not null default false,
  notifications_days     integer not null default 60,
  audit_days             integer not null default 90,
  reminder_days          integer not null default 30,
  closed_requests_days   integer not null default 60,
  resume_uploads_enabled boolean not null default true,
  updated_at             timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Any signed-in user can READ the flags (e.g. candidates need resume_uploads_enabled);
-- only admins can change them. No secrets live here.
drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings
  for select using (auth.uid() is not null);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Delete old rows per the configured windows. Returns how many were removed.
-- Safe for both pg_cron (runs as superuser, auth.uid() is null) and admins;
-- non-admin clients are rejected.
create or replace function public.run_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.app_settings;
  n   integer := 0;
  c   integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into cfg from public.app_settings where id = 1;
  if cfg.id is null or not cfg.retention_enabled then
    return 0;
  end if;

  delete from public.notifications
    where read and created_at < now() - make_interval(days => cfg.notifications_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.audit_log
    where created_at < now() - make_interval(days => cfg.audit_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.reminder_log
    where sent_at < now() - make_interval(days => cfg.reminder_days);
  get diagnostics c = row_count; n := n + c;

  delete from public.interview_requests
    where status in ('cancelled', 'rejected')
      and created_at < now() - make_interval(days => cfg.closed_requests_days);
  get diagnostics c = row_count; n := n + c;

  if n > 0 then
    insert into public.audit_log (actor_id, action, entity_type, summary)
    values (auth.uid(), 'retention', 'system', 'Automatic cleanup removed ' || n || ' rows');
  end if;

  return n;
end;
$$;

grant execute on function public.run_retention() to authenticated;

-- ONE-TIME: schedule a daily 3am sweep (requires pg_cron):
--   select cron.schedule('data-retention', '0 3 * * *',
--     $$ select public.run_retention(); $$);
