-- ---- 0059_history_meeting_link.sql ----
-- Interview Manager — record the time & meeting link the admin sends, in history
-- Run AFTER 0058_admin_notes.sql. Idempotent — safe to re-run.
--
-- log_interview_change() already records created/status/reschedule/payment into
-- audit_log. This adds the actual scheduled TIME and MEETING LINK to the trail so
-- an admin can always see (and keep) exactly what was sent to the candidate. The
-- Manage dialog surfaces these audit rows as a per-interview History.

create or replace function public.log_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'created', 'interview', new.id,
      'Request "' || new.role || '" created'
        || case when new.status = 'scheduled' then ' and scheduled' else '' end);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'status', 'interview', new.id,
      new.role || ': ' || old.status || ' → ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id,
      'Time set to ' || to_char(new.scheduled_at at time zone 'UTC', 'Mon DD, HH24:MI') || ' UTC');
  end if;

  if new.meeting_link is distinct from old.meeting_link then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'meeting_link', 'interview', new.id,
      case when new.meeting_link is not null and new.meeting_link <> ''
           then 'Meeting link set: ' || new.meeting_link
           else 'Meeting link removed' end);
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' → ' || new.payment_status);
  end if;

  return new;
end;
$$;
