-- ---- 0053_busy_override_request.sql ----
-- Interview Manager — "ask about a busy time" requests
-- Run AFTER 0052_google_calendar_sync.sql. Idempotent — safe to re-run.
--
-- A candidate can request a time the admin marked BUSY/blocked. It's a normal
-- interview request flagged busy_override=true; admins get a distinct "exception
-- request" notification and Approve (schedule at that time — it becomes a meeting
-- block) or Reject as usual. One flag column; no new tables (free plan).

alter table public.interview_requests
  add column if not exists busy_override boolean not null default false;

-- Word the admin notification specially for busy-time requests (per-admin timezone).
create or replace function public.notify_admins_new_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  a   record;
begin
  select coalesce(nullif(cp.full_name, ''), cp.email, 'A candidate') into who
  from public.profiles cp where cp.id = new.candidate_id;

  if new.busy_override then
    for a in select id, coalesce(timezone, 'UTC') as tz from public.profiles where role = 'admin' loop
      insert into public.notifications (user_id, title, detail, type)
      values (
        a.id,
        'Busy-time request',
        who || ' asked to book "' || new.role || '" at '
          || to_char(coalesce(new.preferred_at, now()) at time zone a.tz, 'Mon DD, HH24:MI')
          || ' (' || a.tz || ') — a time you marked busy. Approve to schedule it, or reject.',
        'alert'
      );
    end loop;
  else
    insert into public.notifications (user_id, title, detail, type)
    select p.id, 'New interview request', who || ' requested "' || new.role || '"', 'info'
    from public.profiles p where p.role = 'admin';
  end if;
  return new;
end;
$$;
