-- Interview Manager — email notifications via Resend
-- Run AFTER 0017_interview_feedback.sql.
--
-- Every in-app notification is also emailed to its recipient. Configure the
-- Resend API key + "from" address in Admin → Settings → Email. Requires the
-- pg_net extension (same as Telegram reminders).

-- Single-row config, admin-only. The API key stays server-side (RLS + never
-- returned to the browser by the API route).
create table if not exists public.app_email_config (
  id             integer primary key default 1 check (id = 1),
  resend_api_key text,
  email_from     text default 'Interview Scheduler <onboarding@resend.dev>',
  enabled        boolean not null default false,
  updated_at     timestamptz not null default now()
);

alter table public.app_email_config enable row level security;

drop policy if exists "email_config_admin_all" on public.app_email_config;
create policy "email_config_admin_all" on public.app_email_config
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_email_config (id) values (1) on conflict (id) do nothing;

-- Send an email for each new notification (fire-and-forget via pg_net).
create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.app_email_config;
  to_email text;
  html     text;
begin
  select * into cfg from public.app_email_config where id = 1;
  if cfg.id is null or not cfg.enabled or cfg.resend_api_key is null then
    return new;
  end if;

  select email into to_email from public.profiles where id = new.user_id;
  if to_email is null or to_email = '' then
    return new;
  end if;

  html := '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">'
       || '<h2 style="color:#111;font-size:18px">' || new.title || '</h2>'
       || '<p style="color:#444;font-size:14px;line-height:1.6">' || coalesce(new.detail, '') || '</p>'
       || '<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>'
       || '<p style="color:#999;font-size:12px">Interview Scheduler Pro</p></div>';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', coalesce(cfg.email_from, 'Interview Scheduler <onboarding@resend.dev>'),
      'to', to_email,
      'subject', new.title,
      'html', html
    )
  );

  return new;
end;
$$;

drop trigger if exists on_notification_email on public.notifications;
create trigger on_notification_email
  after insert on public.notifications
  for each row execute function public.email_on_notification();
