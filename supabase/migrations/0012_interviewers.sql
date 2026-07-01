-- Interview Manager — assigned interviewer (polish pass)
-- Run AFTER 0011_audit_log.sql.
--
-- Each request can be assigned to an interviewer (an admin). Nullable; existing
-- admin select/update RLS already covers reads and writes.

alter table public.interview_requests
  add column if not exists interviewer_id uuid references public.profiles (id) on delete set null;

create index if not exists interview_requests_interviewer_idx
  on public.interview_requests (interviewer_id);
