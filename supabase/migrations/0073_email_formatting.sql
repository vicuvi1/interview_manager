-- ---- 0073_email_formatting.sql ----
-- Interview Manager — nicer notification emails (formatting only)
-- Run AFTER 0072_candidate_audit_read.sql. Idempotent — safe to re-run.
--
-- The email body was raw title+detail, so multi-line messages (e.g. the
-- completion summary) collapsed onto one line and links weren't clickable. This
-- redefines email_on_notification to: HTML-escape the text, turn URLs into
-- clickable links, and keep line breaks. Behavior/flow is unchanged — and all
-- formatting + sending now runs inside the exception block, so a formatting
-- issue can never block the in-app notification insert.

create or replace function public.email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg          public.app_email_config;
  acct_email   text;
  custom_email text;
  email_on     boolean;
  to_email     text;
  safe_title   text;
  body_html    text;
  html         text;
begin
  select * into cfg from public.app_email_config where id = 1;
  if cfg.id is null or not cfg.enabled or cfg.resend_api_key is null then
    return new;
  end if;

  select email, notify_email, notify_email_enabled
    into acct_email, custom_email, email_on
    from public.profiles where id = new.user_id;

  if not coalesce(email_on, true) then
    return new; -- user turned email notifications off
  end if;

  to_email := coalesce(nullif(trim(custom_email), ''), acct_email);
  if to_email is null or to_email = '' then
    return new;
  end if;

  -- Formatting + send are wrapped so any error still lets the notification
  -- insert succeed (email is best-effort).
  begin
    safe_title := replace(replace(replace(new.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    body_html := replace(replace(replace(coalesce(new.detail, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    -- Make URLs clickable, then preserve line breaks.
    body_html := regexp_replace(body_html, '(https?://[^\s<]+)', '<a href="\1" style="color:#4f46e5;text-decoration:underline">\1</a>', 'g');
    body_html := replace(body_html, E'\n', '<br/>');

    html := '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:8px">'
         || '<h2 style="color:#111;font-size:18px;margin:0 0 8px">' || safe_title || '</h2>'
         || '<p style="color:#444;font-size:14px;line-height:1.6;margin:0">' || body_html || '</p>'
         || '<hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>'
         || '<p style="color:#999;font-size:12px;margin:0">Interview Scheduler Pro</p></div>';

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
  exception when others then
    null; -- pg_net missing or errored — deliver in-app anyway
  end;

  return new;
end;
$$;
