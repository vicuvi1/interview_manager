-- Interview Manager — payments (Phase 4)
-- Run AFTER 0003_scheduling.sql.
--
-- The admin sets an invoice (price_cents); the candidate pays (mock checkout),
-- which flips payment_status to 'paid' and stamps paid_at. RLS already lets the
-- admin update any request and the candidate update their own.

alter table public.interview_requests
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists paid_at timestamptz;
