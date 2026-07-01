-- Interview Manager — crypto wallet payments
-- Run AFTER 0022_candidate_stage.sql.
--
-- The admin lists their receiving wallets (USDT/USDC on BEP20/TRC20/etc). A
-- candidate picks one, sees the address, pays externally, and taps "I've paid".
-- The admin verifies and marks it paid. No amount is shown to the candidate, and
-- candidates can no longer self-mark paid.

create table if not exists public.payment_wallets (
  id         uuid primary key default gen_random_uuid(),
  asset      text not null,            -- USDT, USDC, BTC, ETH, BNB…
  network    text,                     -- BEP20, TRC20, ERC20, SOL…
  address    text not null,
  memo       text,                     -- optional memo/tag some chains need
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.payment_wallets enable row level security;

drop policy if exists "wallets_admin_all" on public.payment_wallets;
create policy "wallets_admin_all" on public.payment_wallets
  for all using (public.is_admin()) with check (public.is_admin());

-- Signed-in users can read active wallets so they can pay (addresses are meant
-- to be shared).
drop policy if exists "wallets_read_active" on public.payment_wallets;
create policy "wallets_read_active" on public.payment_wallets
  for select using (auth.uid() is not null and active);

-- A candidate tells the admins they've sent payment (they can't insert
-- notifications directly). Verified ownership; notifies every admin.
create or replace function public.notify_payment_sent(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.interview_requests;
  who text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id,
         'Payment sent',
         who || ' says they paid for "' || r.role || '". Please verify and mark it paid.',
         'alert'
  from public.profiles p
  where p.role = 'admin';
end;
$$;
grant execute on function public.notify_payment_sent(uuid) to authenticated;

-- Candidates no longer self-mark paid — the admin verifies the transfer.
revoke execute on function public.pay_interview(uuid) from authenticated;
