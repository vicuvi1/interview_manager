-- Interview Manager — candidate tags + interview templates (lightweight org tools)
-- Run AFTER 0020_resume_hygiene.sql.

-- Candidate tags (admin-managed). profiles isn't admin-writable directly, so set
-- them through a SECURITY DEFINER RPC.
alter table public.profiles add column if not exists tags text[];

create or replace function public.set_candidate_tags(p_user uuid, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set tags = p_tags where id = p_user;
end;
$$;
grant execute on function public.set_candidate_tags(uuid, text[]) to authenticated;

-- Reusable interview templates (admin-only) to prefill manual bookings.
create table if not exists public.interview_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  role             text,
  interview_type   text,
  level            text,
  duration_minutes integer not null default 30,
  format           text default 'video',
  notes            text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table public.interview_templates enable row level security;

drop policy if exists "templates_admin_all" on public.interview_templates;
create policy "templates_admin_all" on public.interview_templates
  for all using (public.is_admin()) with check (public.is_admin());
