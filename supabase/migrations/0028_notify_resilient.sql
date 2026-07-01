-- Interview Manager — make notification delivery fault-tolerant
-- Run AFTER 0027_telegram_for_users.sql.
--
-- Telegram/email forwarding must NEVER break the action that created the
-- notification (approve, book, pay…). If pg_net is missing or the provider
-- errors, we swallow it so the notification (and the action) still succeed.

create or replace function public.telegram_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s   public.telegram_settings;
  msg text;
begin
  select * into s from public.telegram_settings where user_id = new.user_id;
  if s.user_id is null or not s.enabled or s.chat_id is null or s.bot_token is null then
    return new;
  end if;

  msg := '🔔 ' || new.title
       || case when coalesce(new.detail, '') <> '' then E'\n' || new.detail else '' end;

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', s.chat_id, 'text', msg, 'disable_web_page_preview', true)
    );
  exception when others then
    null; -- delivery failure / pg_net missing must not block the notification
  end;
  return new;
end;
$$;

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

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || cfg.resend_api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', coalesce(cfg.email_from, 'Interview Scheduler <onboarding@resend.dev>'),
                                 'to', to_email, 'subject', new.title, 'html', html)
    );
  exception when others then
    null; -- delivery failure / pg_net missing must not block the notification
  end;
  return new;
end;
$$;
