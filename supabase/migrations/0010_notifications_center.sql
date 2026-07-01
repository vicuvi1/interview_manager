-- Interview Manager — notification center support (Phase 7)
-- Run AFTER 0009_candidate_notes.sql.
--
-- 1) Users can clear (delete) their own notifications.
-- 2) Admins get a notification when a candidate files a new request, so the
--    admin notification center has live content.

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

create or replace function public.notify_admins_new_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, detail, type)
  select p.id,
         'New interview request',
         coalesce(nullif(cp.full_name, ''), cp.email, 'A candidate')
           || ' requested "' || new.role || '"',
         'info'
  from public.profiles p
  left join public.profiles cp on cp.id = new.candidate_id
  where p.role = 'admin';
  return new;
end;
$$;

drop trigger if exists on_new_request_notify_admins on public.interview_requests;
create trigger on_new_request_notify_admins
  after insert on public.interview_requests
  for each row execute function public.notify_admins_new_request();
