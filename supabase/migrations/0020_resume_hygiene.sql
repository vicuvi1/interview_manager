-- Interview Manager — résumé hygiene (free-tier storage control)
-- Run AFTER 0019_app_settings_retention.sql.

-- Admins can delete any résumé file (candidates already manage their own folder).
drop policy if exists "resumes_admin_delete" on storage.objects;
create policy "resumes_admin_delete" on storage.objects
  for delete using (bucket_id = 'resumes' and public.is_admin());

-- Admin clears a candidate's résumé pointer after removing the file. profiles is
-- not admin-writable directly, so this SECURITY DEFINER RPC is the path.
create or replace function public.admin_clear_resume(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set resume_path = null where id = p_user;
end;
$$;
grant execute on function public.admin_clear_resume(uuid) to authenticated;
