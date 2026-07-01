-- Interview Manager — per-request color + easier "mark paid"
-- Run AFTER 0030_reported_amount.sql.

-- Custom color for a request/event (chosen by the candidate and/or admin).
alter table public.interview_requests add column if not exists color text;

-- When a candidate reports a payment, record the amount on the interview (if it
-- wasn't invoiced yet) so the admin can just open it and mark it paid — instead
-- of a separate standalone payment row.
create or replace function public.notify_payment_sent(
  p_interview_id uuid,
  p_amount       numeric default null,
  p_asset        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.interview_requests;
  who     text;
  amt_txt text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  amt_txt := case when p_amount is not null and p_amount > 0
                  then '$' || trim(to_char(p_amount, 'FM999999990.00')) else 'a payment' end;

  if p_amount is not null and p_amount > 0 and r.price_cents is null then
    update public.interview_requests set price_cents = round(p_amount * 100) where id = p_interview_id;
  end if;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Payment reported',
    who || ' says they sent ' || amt_txt
      || case when p_asset is not null then ' via ' || p_asset else '' end
      || ' for "' || r.role || '". Open it to verify and mark it paid.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid, numeric, text) to authenticated;
