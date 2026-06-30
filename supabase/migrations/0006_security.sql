-- Interview Manager — security hardening (Phase 6)
-- Run AFTER 0005_auto_admin.sql.
--
-- Goal: candidates can only create requests and read their own data. All
-- state changes that matter (status, payment, schedule) happen either through
-- the admin (RLS is_admin) or through the SECURITY DEFINER functions below,
-- which enforce ownership + valid state. This closes the hole where a candidate
-- could self-approve or self-mark-paid by calling the table directly.

-- 1) Candidates may no longer directly UPDATE interview requests.
--    (The admin update policy from 0002 still applies.)
drop policy if exists "interviews_update_own" on public.interview_requests;

-- 2) Candidates may no longer self-insert notifications; the functions below
--    and admins create them.
drop policy if exists "notifications_insert_own" on public.notifications;

-- 3) Prevent privilege escalation through the API: no one may change
--    profiles.role via PostgREST. Replace the blanket UPDATE grant with a
--    column allow-list. (The signup trigger sets role as SECURITY DEFINER.)
revoke update on public.profiles from authenticated;
grant update (full_name, email, timezone) on public.profiles to authenticated;

-- 4) Value constraints (RLS guards who, not what).
do $$ begin
  alter table public.interview_requests
    add constraint interview_requests_duration_chk
    check (duration_minutes between 5 and 480);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.interview_requests
    add constraint interview_requests_price_chk
    check (price_cents is null or price_cents >= 0);
exception when duplicate_object then null; end $$;

-- 5) Candidate pays their own invoice (mock). Swap the body for a Stripe call
--    + webhook to go live; the ownership/state checks stay the same.
create or replace function public.pay_interview(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.interview_requests;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if r.price_cents is null then raise exception 'Nothing to pay'; end if;
  if r.payment_status = 'paid' then return; end if;

  update public.interview_requests
    set payment_status = 'paid', paid_at = now()
    where id = p_interview_id;

  insert into public.notifications (user_id, title, detail, type)
  values (
    r.candidate_id,
    'Payment confirmed',
    'Your payment for "' || r.role || '" was received.',
    'success'
  );
end;
$$;

-- 6) Candidate cancels their own pending/approved/scheduled request.
create or replace function public.cancel_my_request(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.interview_requests;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if r.status not in ('pending', 'approved', 'scheduled') then
    raise exception 'This request can no longer be cancelled';
  end if;

  update public.interview_requests set status = 'cancelled' where id = p_interview_id;
end;
$$;

grant execute on function public.pay_interview(uuid) to authenticated;
grant execute on function public.cancel_my_request(uuid) to authenticated;
