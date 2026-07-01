-- Interview Manager — payments ledger (Phase 4)
-- Run AFTER 0006_security.sql.
--
-- Adapted to our schema: interview_id references interview_requests (not a
-- separate scheduled_interviews table), candidate_id references profiles.
-- The ledger is kept in sync with interview_requests' invoice/payment fields by
-- a trigger, so the existing candidate pay flow keeps working unchanged.

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interview_requests (id) on delete set null,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  amount       numeric(10, 2) not null default 0,
  currency     text not null default 'USD',
  method       text check (method in (
                 'crypto_btc', 'crypto_eth', 'crypto_sol', 'crypto_usdt_erc20',
                 'crypto_usdt_trc20', 'crypto_usdt_bep20', 'crypto_bnb',
                 'bank_transfer', 'cash', 'stripe', 'paypal', 'free', 'training')),
  status       text not null default 'pending'
                 check (status in ('pending', 'paid', 'overdue', 'refunded', 'partial', 'free')),
  paid_at      timestamptz,
  notes        text,
  receipt_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One "invoice" payment per interview (manual payments have interview_id null).
create unique index if not exists payments_interview_uidx
  on public.payments (interview_id) where interview_id is not null;
create index if not exists payments_candidate_idx
  on public.payments (candidate_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select using (auth.uid() = candidate_id);

alter table public.payments replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; end $$;

-- Backfill from existing invoices already recorded on interview_requests.
insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at, method)
select ir.id,
       ir.candidate_id,
       (ir.price_cents::numeric / 100.0),
       coalesce(ir.currency, 'USD'),
       case when ir.payment_status = 'paid' then 'paid' else 'pending' end,
       ir.paid_at,
       case when ir.payment_status = 'paid' then 'stripe' else null end
from public.interview_requests ir
where ir.price_cents is not null
on conflict (interview_id) where interview_id is not null do nothing;

-- Keep the ledger in sync with interview_requests invoice/payment changes.
create or replace function public.sync_payment_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price_cents is not null then
    insert into public.payments (interview_id, candidate_id, amount, currency, status, paid_at)
    values (
      new.id,
      new.candidate_id,
      (new.price_cents::numeric / 100.0),
      coalesce(new.currency, 'USD'),
      case when new.payment_status = 'paid' then 'paid' else 'pending' end,
      new.paid_at
    )
    on conflict (interview_id) where interview_id is not null do update set
      amount = excluded.amount,
      currency = excluded.currency,
      status = case when new.payment_status = 'paid' then 'paid' else payments.status end,
      paid_at = case when new.payment_status = 'paid' then new.paid_at else payments.paid_at end,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_interview_payment_sync on public.interview_requests;
create trigger on_interview_payment_sync
  after insert or update of price_cents, payment_status, paid_at, currency
  on public.interview_requests
  for each row execute function public.sync_payment_from_request();
