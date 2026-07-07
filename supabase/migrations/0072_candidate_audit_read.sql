-- ---- 0072_candidate_audit_read.sql ----
-- Interview Manager — candidates can read the activity trail for THEIR OWN interviews
-- Run AFTER 0071_edit_all_fields.sql. Idempotent — safe to re-run.
--
-- Powers the "Activity" timeline on the candidate interview page. Admins keep
-- full access (RLS policies for the same command are OR'd, so this only widens
-- read access to a candidate's own interview rows — never anyone else's).

drop policy if exists "audit_log_select_own_interview" on public.audit_log;
create policy "audit_log_select_own_interview" on public.audit_log
  for select using (
    entity_type = 'interview'
    and entity_id in (select id from public.interview_requests where candidate_id = auth.uid())
  );
