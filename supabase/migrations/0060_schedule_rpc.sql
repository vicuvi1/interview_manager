-- ---- 0060_schedule_rpc.sql ----
-- Interview Manager — server-side scheduling with conflict detection.
-- Run AFTER 0059_history_meeting_link.sql. Idempotent — safe to re-run.
--
-- Until now every admin "schedule" / "reschedule" / "book" action wrote to
-- interview_requests directly from the browser, gated only by RLS. The overlap
-- check lived purely in the UI grid, so two admins (or one racing themselves, a
-- calendar drag, an accepted reschedule proposal, or a direct API call) could
-- double-book one interviewer onto one time slot.
--
-- These SECURITY DEFINER functions make the database the source of truth. A
-- shared helper takes a per-interviewer transaction lock (so concurrent
-- schedulers are serialized) and rejects any time overlapping another SCHEDULED
-- interview for the same interviewer. schedule_interview() updates an existing
-- request; book_interview() inserts a brand-new already-scheduled one. Callers
-- still send their own candidate notification, so wording/format is unchanged,
-- and the audit-log trigger on interview_requests records the change.

-- Overlap guard shared by both RPCs. NOT granted to `authenticated`: it is only
-- ever called from the two SECURITY DEFINER functions below (which run as the
-- owner and may call it), never directly from the client.
create or replace function public.assert_slot_free(
  p_exclude_id  uuid,        -- interview to ignore (the one being (re)scheduled), or null
  p_at          timestamptz,
  p_duration    integer,
  p_interviewer uuid         -- null = the shared/unassigned calendar
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict public.interview_requests;
begin
  -- Serialize scheduling for this interviewer/calendar so the check below can't
  -- be defeated by two concurrent transactions both seeing the slot as free.
  -- The advisory lock is released automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('schedule:' || coalesce(p_interviewer::text, 'unassigned'), 0)
  );

  -- Any other scheduled interview for the same interviewer whose range
  -- [start, start + duration) overlaps [p_at, p_at + p_duration) is a conflict.
  select * into conflict
  from public.interview_requests o
  where (p_exclude_id is null or o.id <> p_exclude_id)
    and o.status = 'scheduled'
    and o.scheduled_at is not null
    and o.interviewer_id is not distinct from p_interviewer
    and o.scheduled_at < p_at + make_interval(mins => p_duration)
    and o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > p_at
  order by o.scheduled_at
  limit 1;

  if found then
    raise exception 'That time overlaps another scheduled interview ("%" at %). Pick a different slot.',
      conflict.role, to_char(conflict.scheduled_at, 'Mon DD HH24:MI');
  end if;
end;
$$;

-- Schedule / reschedule an EXISTING request.
create or replace function public.schedule_interview(
  p_interview_id   uuid,
  p_scheduled_at   timestamptz,
  p_duration       integer default null,   -- null keeps the existing duration
  p_meeting_link   text    default null,   -- null keeps existing, '' clears, else sets
  p_interviewer_id uuid    default null    -- authoritative: null means "unassigned"
) returns public.interview_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.interview_requests;
  v_dur integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_scheduled_at is null then raise exception 'Pick a time'; end if;
  if p_scheduled_at <= now() then raise exception 'Pick a future time'; end if;

  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;

  v_dur := greatest(coalesce(p_duration, r.duration_minutes, 30), 1);
  perform public.assert_slot_free(p_interview_id, p_scheduled_at, v_dur, p_interviewer_id);

  update public.interview_requests set
    scheduled_at     = p_scheduled_at,
    duration_minutes = v_dur,
    meeting_link     = case when p_meeting_link is null then meeting_link
                            else nullif(trim(p_meeting_link), '') end,
    interviewer_id   = p_interviewer_id,
    proposed_at      = null,
    status           = 'scheduled'
  where id = p_interview_id
  returning * into r;

  return r;
end;
$$;

-- Create a NEW already-scheduled request (admin books on a candidate's behalf).
create or replace function public.book_interview(
  p_candidate_id   uuid,
  p_role           text,
  p_scheduled_at   timestamptz,
  p_duration       integer default 30,
  p_meeting_link   text    default null,
  p_interviewer_id uuid    default null,
  p_interview_type text    default null,
  p_level          text    default null,
  p_format         text    default null
) returns public.interview_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.interview_requests;
  v_dur integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_candidate_id is null then raise exception 'Select a candidate'; end if;
  if coalesce(trim(p_role), '') = '' then raise exception 'Enter a role'; end if;
  if p_scheduled_at is null then raise exception 'Pick a time'; end if;
  if p_scheduled_at <= now() then raise exception 'Pick a future time'; end if;

  v_dur := greatest(coalesce(p_duration, 30), 1);
  perform public.assert_slot_free(null, p_scheduled_at, v_dur, p_interviewer_id);

  insert into public.interview_requests (
    candidate_id, role, interview_type, level, format,
    preferred_at, scheduled_at, duration_minutes, meeting_link,
    interviewer_id, status, payment_status, currency
  ) values (
    p_candidate_id, trim(p_role), nullif(p_interview_type, ''), nullif(p_level, ''), nullif(p_format, ''),
    p_scheduled_at, p_scheduled_at, v_dur, nullif(trim(p_meeting_link), ''),
    p_interviewer_id, 'scheduled', 'unpaid', 'USD'
  )
  returning * into r;

  return r;
end;
$$;

grant execute on function public.schedule_interview(uuid, timestamptz, integer, text, uuid) to authenticated;
grant execute on function public.book_interview(uuid, text, timestamptz, integer, text, uuid, text, text) to authenticated;
