-- Interview Manager — candidate reports the amount they paid
-- Run AFTER 0029_owner_admin.sql.
--
-- When a candidate says "I've paid", they now enter the dollar amount. We record
-- a PENDING payment (so it shows in Revenue) and notify admins with the amount.

drop function if exists public.notify_payment_sent(uuid);

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
                  then '$' || trim(to_char(p_amount, 'FM999999990.00'))
                  else 'a payment' end;

  -- Record a pending payment in the ledger (method left null to satisfy the
  -- check constraint; the asset is noted). Admin verifies + marks paid.
  if p_amount is not null and p_amount > 0 then
    insert into public.payments (candidate_id, amount, currency, status, notes)
    values (r.candidate_id, p_amount, 'USD', 'pending',
            'Candidate-reported (' || coalesce(p_asset, 'crypto') || ') for "' || r.role || '"');
  end if;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Payment reported',
    who || ' says they sent ' || amt_txt
      || case when p_asset is not null then ' via ' || p_asset else '' end
      || ' for "' || r.role || '". Please verify and mark it paid.',
    'alert'
  from public.profiles p where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid, numeric, text) to authenticated;
