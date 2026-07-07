-- ---- 0068_ics_feed.sql ----
-- Interview Manager — per-candidate .ics calendar subscription feed
-- Run AFTER 0067_interview_materials_and_sent.sql. Idempotent — safe to re-run.
--
-- Gives each candidate a secret token; a public /api/calendar?token=… endpoint
-- serves their scheduled interviews as a live .ics feed so they auto-appear in
-- Google/Apple/Outlook. The read RPC is SECURITY DEFINER + token-scoped so the
-- endpoint needs no login (calendar apps can't authenticate).

alter table public.profiles add column if not exists ics_token text;
create unique index if not exists profiles_ics_token_key
  on public.profiles(ics_token) where ics_token is not null;

-- Generate (once) and return the current user's feed token.
create or replace function public.ensure_ics_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  select ics_token into t from public.profiles where id = auth.uid();
  if t is null or t = '' then
    t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.profiles set ics_token = t where id = auth.uid();
  end if;
  return t;
end;
$$;
grant execute on function public.ensure_ics_token() to authenticated;

-- Token-scoped read of a candidate's upcoming/scheduled interviews for the feed.
create or replace function public.ics_feed(p_token text)
returns table (id uuid, role text, scheduled_at timestamptz, duration_minutes integer, meeting_link text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.role, r.scheduled_at, r.duration_minutes, r.meeting_link
  from public.interview_requests r
  join public.profiles p on p.id = r.candidate_id
  where p_token is not null
    and length(p_token) >= 16
    and p.ics_token = p_token
    and r.status = 'scheduled'
    and r.scheduled_at is not null
  order by r.scheduled_at;
$$;
grant execute on function public.ics_feed(text) to anon, authenticated;
