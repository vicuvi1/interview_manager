-- Interview Manager — privacy hardening + user blocking
-- Run AFTER 0012_interviewers.sql.

-- 1) PRIVACY: candidates must never see each other's data.
--    availability_slots previously allowed any signed-in user to SELECT every
--    row — including "event" slots that can reference a specific candidate
--    (candidate_id, meeting_link, notes). No candidate feature reads this table,
--    so restrict SELECT to admins. (The admin_all policy from 0008 still applies.)
drop policy if exists "availability_select_auth" on public.availability_slots;

-- 2) BLOCKING: let admins suspend a user's access.
alter table public.profiles add column if not exists blocked boolean not null default false;

-- Is the current user blocked? SECURITY DEFINER to avoid RLS recursion.
create or replace function public.is_blocked()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select blocked from public.profiles where id = auth.uid()), false);
$$;

-- Blocked users can no longer create interview requests.
drop policy if exists "interviews_insert_own" on public.interview_requests;
create policy "interviews_insert_own" on public.interview_requests
  for insert with check (auth.uid() = candidate_id and not public.is_blocked());

-- Admin-only block/unblock. `blocked` is never a client-writable column
-- (profiles column grants exclude it), so this SECURITY DEFINER RPC is the only
-- path — it verifies is_admin(), logs to the audit trail, and notifies the user.
create or replace function public.set_user_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.profiles set blocked = p_blocked where id = p_user;

  select coalesce(nullif(full_name, ''), email, 'A user') into who
  from public.profiles where id = p_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when p_blocked then 'blocked' else 'unblocked' end,
    'user',
    p_user,
    who || case when p_blocked then ' was blocked' else ' was unblocked' end
  );

  insert into public.notifications (user_id, title, detail, type)
  values (
    p_user,
    case when p_blocked then 'Account suspended' else 'Account reinstated' end,
    case when p_blocked
         then 'Your access has been suspended. Please contact support.'
         else 'Your access has been restored. Welcome back.' end,
    case when p_blocked then 'alert' else 'success' end
  );
end;
$$;

grant execute on function public.set_user_blocked(uuid, boolean) to authenticated;
