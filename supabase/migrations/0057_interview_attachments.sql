-- ---- 0057_interview_attachments.sql ----
-- Interview Manager — file/image attachments on an interview
-- Run AFTER 0056_reminders_cron_and_versioning.sql. Idempotent — safe to re-run.
--
-- Files live in the existing private "resumes" bucket (owner read/write, admin
-- read). We store only { name, path } refs here — no blobs (free plan).

alter table public.interview_requests
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Extend edit_my_interview so candidates can also add/remove attachments later.
drop function if exists public.edit_my_interview(uuid, text, text, text);
create or replace function public.edit_my_interview(
  p_interview_id uuid,
  p_role         text  default null,
  p_notes        text  default null,
  p_meeting_link text  default null,
  p_attachments  jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set
    role         = coalesce(nullif(trim(p_role), ''), role),
    notes        = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    meeting_link = case when p_meeting_link is null then meeting_link else nullif(trim(p_meeting_link), '') end,
    attachments  = coalesce(p_attachments, attachments),
    last_edited_at = now(),
    last_edited_by = auth.uid()
  where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview details edited',
    who || ' updated the details for "' || (select role from public.interview_requests where id = p_interview_id) || '".',
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.edit_my_interview(uuid, text, text, text, jsonb) to authenticated;
