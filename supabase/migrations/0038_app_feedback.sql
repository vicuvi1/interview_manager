-- Interview Manager — in-app feedback (bug reports / feature ideas from candidates)
-- Run AFTER 0037_public_booking_and_digest.sql.
--
-- Candidates submit feedback; admins get a notification (which forwards to their
-- Telegram) carrying the person's name + message.

create table if not exists public.app_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  name       text,
  email      text,
  category   text not null default 'idea' check (category in ('bug', 'idea', 'other')),
  message    text not null,
  status     text not null default 'new' check (status in ('new', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);

alter table public.app_feedback enable row level security;

-- Signed-in users can submit their own feedback.
drop policy if exists "feedback_insert_own" on public.app_feedback;
create policy "feedback_insert_own" on public.app_feedback
  for insert to authenticated with check (auth.uid() = user_id);

-- Users can read their own; admins can read/manage everything.
drop policy if exists "feedback_read_own" on public.app_feedback;
create policy "feedback_read_own" on public.app_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "feedback_admin_all" on public.app_feedback;
create policy "feedback_admin_all" on public.app_feedback
  for all using (public.is_admin()) with check (public.is_admin());

grant insert, select on public.app_feedback to authenticated;

-- Notify admins (and forward to Telegram) with the name + message.
create or replace function public.notify_admins_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who   text;
  title text;
begin
  who := coalesce(nullif(new.name, ''), new.email, 'A user');
  title := case new.category
             when 'bug' then '🐛 Bug report'
             when 'idea' then '💡 Feature idea'
             else '📩 New feedback'
           end;
  insert into public.notifications (user_id, title, detail, type)
  select p.id, title,
    'From ' || who
      || case when new.email is not null and new.email <> '' then ' (' || new.email || ')' else '' end
      || E'\n' || new.message,
    'info'
  from public.profiles p where p.role = 'admin';
  return new;
end;
$$;

drop trigger if exists on_feedback_notify on public.app_feedback;
create trigger on_feedback_notify
  after insert on public.app_feedback
  for each row execute function public.notify_admins_feedback();

alter table public.app_feedback replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.app_feedback;
exception when duplicate_object then null; end $$;
