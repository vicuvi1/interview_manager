-- ---- 0046_per_user_email_prefs.sql ----
-- Interview Manager — per-user email notification preferences
-- Run AFTER 0045_telegram_diagnostics.sql. Idempotent — safe to re-run.
--
-- Until now email forwarding was all-or-nothing (global app_email_config) and
-- always went to the account email. Users can now choose whether to also get
-- their notifications by email, and send them to their login email or a
-- different address.

-- 1) Preference columns on the user's own profile.
alter table public.profiles
  add column if not exists notify_email_enabled boolean not null default true;
alter table public.profiles
  add column if not exists notify_email text;

-- Let each user manage their own preference from the app. The column-level grant
-- keeps role/etc. locked; profiles_update_own RLS still restricts it to their row.
grant update (notify_email_enabled, notify_email) on public.profiles to authenticated;

-- 2) The email-forward trigger now respects the per-user toggle + custom address.
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

  -- A custom address wins; otherwise fall back to the account email.
  to_email := coalesce(nullif(trim(custom_email), ''), acct_email);
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
