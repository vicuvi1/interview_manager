-- Interview Manager — fix audit FK + richer booking fields
-- Run AFTER 0023_payment_wallets.sql.

-- 1) FIX: some auth users may have no profiles row (e.g. created before the
--    signup trigger existed during setup). The audit trigger then fails its FK
--    on insert and blocks booking. Backfill any missing profiles.
insert into public.profiles (id, email, full_name, timezone, role)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', ''),
       coalesce(u.raw_user_meta_data ->> 'timezone', 'UTC'),
       case when lower(u.email) = 'victorbarbuta54@gmail.com' then 'admin' else 'candidate' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- 2) Make the audit trigger resilient: if the actor somehow has no profile row,
--    log with a null actor instead of failing the whole insert.
create or replace function public.log_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is not null and not exists (select 1 from public.profiles where id = actor) then
    actor := null;
  end if;

  if TG_OP = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'created', 'interview', new.id,
      'Request "' || new.role || '" created'
        || case when new.status = 'scheduled' then ' and scheduled' else '' end);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'status', 'interview', new.id, new.role || ': ' || old.status || ' → ' || new.status);
  end if;

  if new.scheduled_at is distinct from old.scheduled_at and new.scheduled_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'scheduled', 'interview', new.id, 'Rescheduled "' || new.role || '"');
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (actor, 'payment', 'interview', new.id,
      new.role || ' payment: ' || old.payment_status || ' → ' || new.payment_status);
  end if;

  return new;
end;
$$;

-- 3) New booking fields: notes for the caller + a job description (link or file).
alter table public.interview_requests
  add column if not exists caller_notes   text,
  add column if not exists job_desc_url   text,
  add column if not exists job_desc_path  text;
