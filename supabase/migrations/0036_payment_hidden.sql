-- Interview Manager — soft-hide settled invoices from the Payments board
-- Run AFTER 0035_tg_commands_and_reverse_booking.sql.
--
-- A paid invoice can be hidden from the "Recently paid" list to tidy the board,
-- WITHOUT deleting it — revenue history and KPIs still count it.

alter table public.interview_requests
  add column if not exists payment_hidden boolean not null default false;
