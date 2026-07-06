-- ---- 0062_self_service_booking.sql ----
-- Interview Manager — true self-service booking (Calendly-style).
-- Run AFTER 0061_calendar_color_grant.sql. Idempotent — safe to re-run.
--
-- Until now, picking a green "Available" time on the candidate calendar still
-- only created a PENDING request the admin had to confirm by hand. This adds a
-- candidate-callable RPC that, when the chosen time really is inside published
-- availability (no busy/booked conflict) and passes the booking rules, flips the
-- request straight to `scheduled` — no admin step. If the slot isn't actually
-- open (race, rules, outside availability) it returns false and the request just
-- stays pending, so the old request-and-wait path is the graceful fallback.
--
-- The recurrence math mirrors the client's lib/slots.ts expandRecurring exactly:
-- occurrences repeat FORWARD from the anchor only (k >= 0), by a fixed 1-day /
-- 7-day millisecond step (DST-naive, but consistent with what the UI draws).

-- Does a (possibly recurring) slot [a_s, a_e) fully COVER the target [t_s, t_e)?
create or replace function public.slot_covers(
  a_s timestamptz, a_e timestamptz, rule text, t_s timestamptz, t_e timestamptz
) returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  step_s double precision;
  dur_s  double precision := extract(epoch from (a_e - a_s));
  k      bigint;
  i      int;
  occ_s  timestamptz;
begin
  if rule not in ('daily', 'weekly') then
    return a_s <= t_s and a_e >= t_e;
  end if;
  step_s := case when rule = 'daily' then 86400 else 604800 end;
  k := floor(extract(epoch from (t_s - a_s)) / step_s);
  for i in -1..1 loop
    if (k + i) < 0 then continue; end if;                 -- no backward recurrence
    occ_s := a_s + make_interval(secs => (k + i) * step_s);
    if occ_s <= t_s and (occ_s + make_interval(secs => dur_s)) >= t_e then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Does a (possibly recurring) slot [a_s, a_e) OVERLAP the target [t_s, t_e)?
create or replace function public.slot_overlaps_target(
  a_s timestamptz, a_e timestamptz, rule text, t_s timestamptz, t_e timestamptz
) returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  step_s double precision;
  dur_s  double precision := extract(epoch from (a_e - a_s));
  k      bigint;
  i      int;
  occ_s  timestamptz;
begin
  if rule not in ('daily', 'weekly') then
    return a_s < t_e and a_e > t_s;
  end if;
  step_s := case when rule = 'daily' then 86400 else 604800 end;
  k := floor(extract(epoch from (t_s - a_s)) / step_s);
  for i in -1..1 loop
    if (k + i) < 0 then continue; end if;
    occ_s := a_s + make_interval(secs => (k + i) * step_s);
    if occ_s < t_e and (occ_s + make_interval(secs => dur_s)) > t_s then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Confirm a pending request instantly IF its time is genuinely open. Returns
-- true when it was scheduled, false when it wasn't eligible (left pending).
create or replace function public.book_available_slot(p_interview_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.interview_requests;
  t_s        timestamptz;
  t_e        timestamptz;
  min_notice int;
  horizon    int;
  cand_tz    text;
  cand_name  text;
begin
  select * into r from public.interview_requests where id = p_interview_id;
  if not found then raise exception 'Interview not found'; end if;
  if r.candidate_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if r.status <> 'pending' then return false; end if;   -- only auto-confirm fresh requests
  if coalesce(r.busy_override, false) then return false; end if; -- exceptions need an admin

  t_s := coalesce(r.scheduled_at, r.preferred_at);
  if t_s is null or t_s <= now() then return false; end if;
  t_e := t_s + make_interval(mins => coalesce(r.duration_minutes, 30));

  -- Booking rules (same fields the client checks).
  select coalesce(min_notice_hours, 0), coalesce(booking_horizon_days, 0)
    into min_notice, horizon
  from public.app_settings where id = 1;
  if min_notice > 0 and t_s < now() + make_interval(hours => min_notice) then return false; end if;
  if horizon > 0 and t_s > now() + make_interval(days => horizon) then return false; end if;

  -- Serialize bookings so two candidates can't grab the same slot at once.
  perform pg_advisory_xact_lock(hashtextextended('booking:global', 0));

  -- Must fall inside a published available window …
  if not exists (
    select 1 from public.availability_slots
    where slot_type = 'available'
      and public.slot_covers(starts_at, ends_at, repeat_rule, t_s, t_e)
  ) then
    return false;
  end if;

  -- … and not collide with a busy/event block …
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

  -- Open — confirm it.
  update public.interview_requests
    set status = 'scheduled',
        scheduled_at = t_s,
        meeting_link = coalesce(meeting_link, 'https://meet.jit.si/InterviewPro-' || replace(r.id::text, '-', ''))
    where id = r.id;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into cand_name
    from public.profiles where id = r.candidate_id;

  insert into public.notifications (user_id, title, detail, type)
  select p.id, 'Interview booked',
    cand_name || ' booked "' || r.role || '" for '
      || to_char(t_s at time zone coalesce(p.timezone, 'UTC'), 'Mon DD, HH24:MI')
      || ' (' || coalesce(p.timezone, 'UTC') || ').',
    'approved'
  from public.profiles p where p.role = 'admin';

  select coalesce(timezone, 'UTC') into cand_tz from public.profiles where id = r.candidate_id;
  insert into public.notifications (user_id, title, detail, type)
  values (r.candidate_id, 'Interview confirmed',
    'Your interview for "' || r.role || '" is booked for '
      || to_char(t_s at time zone cand_tz, 'Mon DD, HH24:MI') || ' (' || cand_tz || ').',
    'approved');

  return true;
end;
$$;

grant execute on function public.book_available_slot(uuid) to authenticated;
