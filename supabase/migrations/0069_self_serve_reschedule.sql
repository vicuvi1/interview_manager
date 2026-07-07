-- ---- 0069_self_serve_reschedule.sql ----
-- Interview Manager — candidate self-serve reschedule into an open slot
-- Run AFTER 0068_ics_feed.sql. Idempotent — safe to re-run.
--
-- Lets a candidate move their OWN approved/scheduled interview to a new time
-- INSTANTLY when that time is genuinely inside published availability (no
-- busy/event/other-candidate conflict) and passes the booking rules. Mirrors
-- book_available_slot's validation exactly. Returns false when the time isn't
-- open — the client then falls back to propose_reschedule (admin confirms), so
-- a candidate can never silently grab an unavailable time.

create or replace function public.reschedule_to_open_slot(p_interview_id uuid, p_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.interview_requests;
  t_s        timestamptz := p_at;
  t_e        timestamptz;
  min_notice int;
  horizon    int;
  cand_tz    text;
  cand_name  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if r.status not in ('approved', 'scheduled') then return false; end if;
  if coalesce(r.busy_override, false) then return false; end if;

  if t_s is null or t_s <= now() then return false; end if;
  t_e := t_s + make_interval(mins => coalesce(r.duration_minutes, 30));

  select coalesce(min_notice_hours, 0), coalesce(booking_horizon_days, 0)
    into min_notice, horizon
  from public.app_settings where id = 1;
  if min_notice > 0 and t_s < now() + make_interval(hours => min_notice) then return false; end if;
  if horizon > 0 and t_s > now() + make_interval(days => horizon) then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('booking:global', 0));

  -- Inside a published available window …
  if not exists (
    select 1 from public.availability_slots
    where slot_type = 'available'
      and public.slot_covers(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- … not colliding with a busy/event block …
  if exists (
    select 1 from public.availability_slots
    where slot_type in ('busy', 'event')
      and public.slot_overlaps_target(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- … or another candidate's confirmed/accepted interview.
  if exists (
    select 1 from public.interview_requests o
    where o.id <> r.id
      and o.candidate_id is distinct from r.candidate_id
      and (
        (o.status = 'scheduled' and o.scheduled_at is not null
          and o.scheduled_at < t_e
          and o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
        or (o.status = 'approved' and o.preferred_at is not null
          and o.preferred_at < t_e
          and o.preferred_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > t_s)
      )
  ) then
    return false;
  end if;

  -- Open — move it and confirm.
  update public.interview_requests
    set status = 'scheduled',
        scheduled_at = t_s,
        proposed_at = null,
        meeting_link = coalesce(meeting_link, 'https://meet.jit.si/InterviewPro-' || replace(r.id::text, '-', ''))
    where id = r.id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into cand_name
    from public.profiles where id = r.candidate_id;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview rescheduled',
    cand_name || ' moved "' || r.role || '" to '
      || to_char(t_s at time zone coalesce(p.timezone, 'UTC'), 'Mon DD, HH24:MI')
      || ' (' || coalesce(p.timezone, 'UTC') || ').',
    'approved'
  from public.profiles p where p.role = 'admin';

  select coalesce(timezone, 'UTC') into cand_tz from public.profiles where id = r.candidate_id;
  insert into public.notifications (user_id, title, detail, type)
  values (r.candidate_id, 'Interview rescheduled',
    'Your interview for "' || r.role || '" is now booked for '
      || to_char(t_s at time zone cand_tz, 'Mon DD, HH24:MI') || ' (' || cand_tz || ').',
    'approved');

  return true;
end;
$$;

grant execute on function public.reschedule_to_open_slot(uuid, timestamptz) to authenticated;
