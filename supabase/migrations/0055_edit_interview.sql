-- ---- 0055_edit_interview.sql ----
-- Interview Manager — candidates edit their interview anytime + edit tracking
-- Run AFTER 0054_booking_privacy.sql. Idempotent — safe to re-run.
--
-- Candidates can update key fields of their OWN interview at any time (even after
-- it's scheduled). RLS blocks direct updates, so this SECURITY DEFINER RPC does it,
-- stamps last_edited_at/by, and notifies admins (which forwards to Telegram/email).

alter table public.interview_requests add column if not exists last_edited_at timestamptz;
alter table public.interview_requests add column if not exists last_edited_by uuid references auth.users(id) on delete set null;

create or replace function public.edit_my_interview(
  p_interview_id uuid,
  p_role         text default null,
  p_notes        text default null,
  p_meeting_link text default null
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
    role         = coalesce(nullif(trim(p_role), ''), role),          -- role can't be blanked
    notes        = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    meeting_link = case when p_meeting_link is null then meeting_link else nullif(trim(p_meeting_link), '') end,
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

grant execute on function public.edit_my_interview(uuid, text, text, text) to authenticated;
