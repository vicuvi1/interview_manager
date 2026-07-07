-- ---- 0066_telegram_formatting.sql ----
-- Interview Manager — cleaner, correctly-encoded Telegram notifications
-- Run AFTER 0065_edit_interview_type_duration.sql. Idempotent — safe to re-run.
--
-- Fixes the garbled emoji prefix (a literal emoji in an earlier migration was
-- stored as mojibake, showing up as "ðŸ""" in Telegram) and organizes each
-- message: a per-type icon, a bold title, then the detail on its own line —
-- using Telegram HTML formatting. Emojis are built from numeric code points via
-- chr() so they can't be corrupted by the file/client encoding again, and the
-- request is sent as explicit UTF-8.

create or replace function public.telegram_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.telegram_settings;
  icon  text;
  title text;
  body  text;
  msg   text;
begin
  select * into s from public.telegram_settings where user_id = new.user_id;
  if s.user_id is null or not s.enabled or s.chat_id is null or s.bot_token is null then
    return new;
  end if;

  -- Per-type icon (numeric code points — encoding-proof).
  icon := case new.type
            when 'approved' then chr(9989)     -- ✅
            when 'success'  then chr(127881)   -- 🎉
            when 'rejected' then chr(10060)    -- ❌
            when 'alert'    then chr(9888)     -- ⚠
            else                 chr(128276)   -- 🔔  (info / default)
          end;

  -- HTML-escape user-supplied text so parse_mode=HTML can't break on & < >.
  title := replace(replace(replace(coalesce(new.title, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  body  := replace(replace(replace(coalesce(new.detail, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  msg := icon || ' <b>' || title || '</b>'
       || case when body <> '' then E'\n' || body else '' end;

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json; charset=utf-8'),
      body := jsonb_build_object(
        'chat_id', s.chat_id,
        'text', msg,
        'parse_mode', 'HTML',
        'disable_web_page_preview', true
      )
    );
  exception when others then
    null; -- never let a Telegram hiccup roll back the notification
  end;
  return new;
end;
$$;

drop trigger if exists on_notification_telegram on public.notifications;
create trigger on_notification_telegram
  after insert on public.notifications
  for each row execute function public.telegram_on_notification();
