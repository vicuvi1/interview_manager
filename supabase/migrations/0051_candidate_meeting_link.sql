-- ---- 0051_candidate_meeting_link.sql ----
-- Interview Manager — let a candidate set/edit their own meeting link
-- Run AFTER 0050_interview_type_styles.sql. Idempotent — safe to re-run.
--
-- Candidates can add a meeting link at booking (insert), but RLS blocks them from
-- updating a request afterwards. This SECURITY DEFINER RPC lets a candidate set or
-- change the meeting link on their OWN interview later, and notifies admins (which
-- forwards to Telegram/email) so they get the link right away.

create or replace function public.set_my_meeting_link(p_interview_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.interview_requests;
  who  text;
  link text := nullif(trim(p_url), '');
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized'; end if;

  update public.interview_requests set meeting_link = link where id = p_interview_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Meeting link updated',
    who || ' set the meeting link for "' || r.role || '"'
      || case when link is not null then ': ' || link else ' (removed it)' end,
    'info'
  from public.profiles p where p.role = 'admin';
end;
$$;

grant execute on function public.set_my_meeting_link(uuid, text) to authenticated;
