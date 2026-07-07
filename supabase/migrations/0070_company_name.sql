-- ---- 0070_company_name.sql ----
-- Interview Manager — company name on an interview request
-- Run AFTER 0069_self_serve_reschedule.sql. Idempotent — safe to re-run.
--
-- Candidates can name the company an interview is for. It's a plain nullable
-- column governed by the existing row RLS (interview_requests has table-level
-- grants, so no per-column grant is needed — unlike profiles). Search stays
-- client-side over already-fetched rows and also scans the free-text fields, so
-- no index or RPC is required here.

alter table public.interview_requests add column if not exists company text;
