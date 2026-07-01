-- Interview Manager — candidate pipeline stage (HR → Technical → Final)
-- Run AFTER 0021_tags_and_templates.sql.

alter table public.profiles
  add column if not exists stage text not null default 'applied';

-- Admin moves a candidate along the pipeline. profiles isn't admin-writable
-- directly, so go through this SECURITY DEFINER RPC (logs + notifies).
create or replace function public.set_candidate_stage(p_user uuid, p_stage text)
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

  update public.profiles set stage = p_stage where id = p_user;

  select coalesce(nullif(full_name, ''), email, 'A candidate') into who
  from public.profiles where id = p_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'stage', 'user', p_user, who || ' → ' || p_stage);

  insert into public.notifications (user_id, title, detail, type)
  values (
    p_user,
    case when p_stage = 'rejected' then 'Application update' else 'Interview progress' end,
    case when p_stage = 'rejected'
         then 'Thank you for interviewing with us. We won''t be moving forward at this time.'
         when p_stage = 'hired'
         then 'Great news — you''ve reached the offer stage!'
         else 'Your application has moved forward.' end,
    case when p_stage = 'rejected' then 'alert' else 'success' end
  );
end;
$$;

grant execute on function public.set_candidate_stage(uuid, text) to authenticated;
