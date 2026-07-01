-- Interview Manager — calendar bookings are requests (admin-approved)
-- Run AFTER 0025_candidate_booking.sql.
--
-- A candidate can propose ANY time (green slots are only suggestions). Booking
-- creates a PENDING request at their preferred time; the admin approves and
-- confirms it. No auto-schedule, no double-booking block (admins resolve clashes).

create or replace function public.book_open_slot(
  p_role           text,
  p_starts_at      timestamptz,
  p_duration       integer,
  p_interview_type text default null,
  p_format         text default 'video',
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  dur    integer := greatest(5, least(480, coalesce(p_duration, 30)));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_blocked() then raise exception 'Your account is suspended'; end if;
  if coalesce(btrim(p_role), '') = '' then raise exception 'Role is required'; end if;
  if p_starts_at <= now() then raise exception 'Pick a future time'; end if;

  insert into public.interview_requests
    (candidate_id, role, interview_type, format, preferred_at, duration_minutes, notes, status)
  values (auth.uid(), btrim(p_role), p_interview_type, coalesce(p_format, 'video'),
          p_starts_at, dur, p_notes, 'pending')
  returning id into new_id;

  -- Confirm to the candidate. (Admins are already notified by the
  -- notify_admins_new_request trigger that fires on every new request.)
  insert into public.notifications (user_id, title, detail, type)
  values (auth.uid(), 'Request received',
    'Your requested time for "' || btrim(p_role) || '" was sent for approval.', 'info');

  return new_id;
end;
$$;
