-- Interview Manager — booking privacy hardening
-- Run AFTER 0053_busy_override_request.sql.
--
-- Candidates must only see other users' times as anonymous "busy" blocks — never
-- names, emails, or roles. Admin-accepted requests (approved with a time, or
-- scheduled) block the slot for everyone else.

-- Belt-and-suspenders: candidates must not read availability_slots directly.
drop policy if exists "availability_select_auth" on public.availability_slots;

create or replace function public.get_booking_availability(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return (
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
          'starts_at', slot_at,
          'ends_at', slot_at + make_interval(mins => coalesce(duration_minutes, 30))))
        from (
          select
            coalesce(scheduled_at, preferred_at) as slot_at,
            duration_minutes
          from public.interview_requests
          where candidate_id is distinct from auth.uid()
            and (
              (status = 'scheduled' and scheduled_at is not null)
              or (status = 'approved' and preferred_at is not null)
            )
            and coalesce(scheduled_at, preferred_at) >= p_from - interval '1 day'
            and coalesce(scheduled_at, preferred_at) <= p_to + interval '1 day'
        ) blocked
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_booking_availability(timestamptz, timestamptz) to authenticated;
