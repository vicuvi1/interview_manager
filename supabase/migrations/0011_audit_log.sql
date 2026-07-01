-- Interview Manager — audit log + admin manual controls (Phase 8)
-- Run AFTER 0010_notifications_center.sql.
--
-- Every meaningful change to an interview request is logged automatically by a
-- trigger (actor = the calling user), so the activity log is reliable no matter
-- who made the change or how (admin console, bulk action, or candidate RPC).

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null default 'interview',
  entity_id   uuid,
  summary     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_admin_select" on public.audit_log;
create policy "audit_log_admin_select" on public.audit_log
  for select using (public.is_admin());

drop policy if exists "audit_log_admin_insert" on public.audit_log;
create policy "audit_log_admin_insert" on public.audit_log
  for insert with check (public.is_admin());

alter table public.audit_log replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.audit_log;
exception when duplicate_object then null; end $$;

-- Admins can create requests on a candidate's behalf (manual booking).
drop policy if exists "interviews_insert_admin" on public.interview_requests;
create policy "interviews_insert_admin" on public.interview_requests
  for insert with check (public.is_admin());

-- Automatic audit trail for interview requests.
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

drop trigger if exists on_interview_audit on public.interview_requests;
create trigger on_interview_audit
  after insert or update on public.interview_requests
  for each row execute function public.log_interview_change();
