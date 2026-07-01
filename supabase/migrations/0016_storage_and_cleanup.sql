-- Interview Manager — résumé uploads + storage/data admin tools
-- Run AFTER 0015_richer_requests.sql.

-- 1) Where an uploaded résumé lives (a path inside the private "resumes" bucket).
alter table public.profiles add column if not exists resume_path text;
grant update (resume_path) on public.profiles to authenticated;

-- 2) Private bucket for résumés. Files are namespaced by user id: "<uid>/<file>".
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Candidates manage only their own folder; admins can read every résumé.
drop policy if exists "resumes_owner_rw" on storage.objects;
create policy "resumes_owner_rw" on storage.objects
  for all
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes_admin_read" on storage.objects;
create policy "resumes_admin_read" on storage.objects
  for select
  using (bucket_id = 'resumes' and public.is_admin());

-- 3) Storage/usage stats for the admin panel (bytes per table + bucket size).
create or replace function public.get_storage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;

  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', tbl, 'rows', rows, 'bytes', bytes) order by bytes desc)
      from (
        select c.relname as tbl,
               greatest(c.reltuples, 0)::bigint as rows,
               pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      ) t
    ), '[]'::jsonb),
    'storage_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'resumes'), 0),
    'storage_files', coalesce((select count(*) from storage.objects where bucket_id = 'resumes'), 0)
  ) into result;

  return result;
end;
$$;
grant execute on function public.get_storage_stats() to authenticated;

-- 4) Cleanup actions to free space. Returns the number of rows removed.
create or replace function public.cleanup_data(p_target text, p_older_than_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_older_than_days, 0), 0));
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;

  if p_target = 'read_notifications' then
    delete from public.notifications where read and created_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'audit_log' then
    delete from public.audit_log where created_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'reminder_log' then
    delete from public.reminder_log where sent_at < cutoff;
    get diagnostics n = row_count;
  elsif p_target = 'closed_requests' then
    delete from public.interview_requests
      where status in ('cancelled', 'rejected') and created_at < cutoff;
    get diagnostics n = row_count;
  else
    raise exception 'Unknown cleanup target: %', p_target;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, summary)
  values (auth.uid(), 'cleanup', 'system',
    'Removed ' || n || ' ' || replace(p_target, '_', ' ') || ' older than ' || p_older_than_days || ' days');

  return n;
end;
$$;
grant execute on function public.cleanup_data(text, integer) to authenticated;
