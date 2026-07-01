-- Interview Manager — candidate self-booking (Google-Calendar style)
-- Run AFTER 0024_booking_form.sql.
--
-- Candidates never read the admin's calendar directly. Two SECURITY DEFINER RPCs:
--   get_booking_availability → anonymized free/blocked time ranges (no names)
--   book_open_slot           → validates + books, guarding against double-booking.

create or replace function public.get_booking_availability(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'repeat_rule', repeat_rule))
      from public.availability_slots where slot_type = 'available'
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'repeat_rule', repeat_rule))
      from public.availability_slots where slot_type in ('busy', 'event')
    ), '[]'::jsonb),
    'taken', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', scheduled_at,
        'ends_at', scheduled_at + make_interval(mins => coalesce(duration_minutes, 30))))
      from public.interview_requests
      where status = 'scheduled' and scheduled_at is not null
        and scheduled_at >= p_from - interval '1 day'
        and scheduled_at <= p_to + interval '1 day'
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.get_booking_availability(timestamptz, timestamptz) to authenticated;

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
  who    text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_blocked() then raise exception 'Your account is suspended'; end if;
  if coalesce(btrim(p_role), '') = '' then raise exception 'Role is required'; end if;
  if p_starts_at <= now() then raise exception 'Pick a future time'; end if;

  -- Double-booking guard against existing scheduled interviews.
  if exists (
    select 1 from public.interview_requests
    where status = 'scheduled' and scheduled_at is not null
      and tstzrange(scheduled_at, scheduled_at + make_interval(mins => coalesce(duration_minutes, 30)))
          && tstzrange(p_starts_at, p_starts_at + make_interval(mins => dur))
  ) then
    raise exception 'That time was just taken — please pick another.';
  end if;

  insert into public.interview_requests
    (candidate_id, role, interview_type, format, preferred_at, scheduled_at, duration_minutes, notes, status)
  values (auth.uid(), btrim(p_role), p_interview_type, coalesce(p_format, 'video'),
          p_starts_at, p_starts_at, dur, p_notes, 'scheduled')
  returning id into new_id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, detail, type)
  values (auth.uid(), 'Interview booked',
    'Your interview for "' || btrim(p_role) || '" is booked. We''ll share the details soon.', 'approved');

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'New booking', who || ' booked "' || btrim(p_role) || '"', 'info'
  from public.profiles p where p.role = 'admin';

  return new_id;
end;
$$;
grant execute on function public.book_open_slot(text, timestamptz, integer, text, text, text) to authenticated;
