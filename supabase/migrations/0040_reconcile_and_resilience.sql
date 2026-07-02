-- Interview Manager — payment reconciliation + email resilience
-- Run AFTER 0039_user_calendar_color.sql.

-- ============================================================
-- 1) Reconcile the payments ledger with interview_requests, the source of truth:
--    * removing an invoice (price_cents → null) now DELETES the synced ledger row
--      (manual standalone payments have interview_id = null and are untouched)
--    * marking an interview unpaid reverts the ledger row to pending + clears paid_at
-- ============================================================
create or replace function public.sync_payment_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price_cents is null then
    delete from public.payments where interview_id = new.id;
    return new;
  end if;

  insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at)
  values (
    new.id,
    new.candidate_id,
    (new.price_cents::numeric / 100.0),
    coalesce(new.currency, 'USD'),
    case when new.payment_status = 'paid' then 'paid' else 'pending' end,
    case when new.payment_status = 'paid' then new.paid_at else null end
  )
  on conflict (interview_id) where interview_id is not null do update set
    amount   = excluded.amount,
    currency = excluded.currency,
    status   = case when new.payment_status = 'paid' then 'paid' else 'pending' end,
    paid_at  = case when new.payment_status = 'paid' then new.paid_at else null end,
    updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2) Email resilience: never let a Resend/pg_net hiccup roll back the
--    notification insert (and the action that triggered it).
-- ============================================================
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
