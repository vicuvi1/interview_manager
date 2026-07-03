-- ---- 0052_google_calendar_sync.sql ----
-- Interview Manager — two-way Google Calendar sync (multi-account) + drag support
-- Run AFTER 0051_candidate_meeting_link.sql. Idempotent — safe to re-run.
--
-- Design (kept lean for the free Supabase plan — we store IDs/tokens/sync
-- cursors only, never event bodies):
--  * google_accounts   — per-user OAuth accounts (MANY per user). Tokens are a
--                        per-user secret: owner-only RLS, NEVER selected to the
--                        browser (mirrors telegram_settings).
--  * google_calendars  — calendars under each account; `selected` to sync, one
--                        `is_push_target` per user (where new events are created);
--                        `sync_token` is the incremental-pull cursor.
--  * google_event_links— interview_id <-> (calendar, google_event_id) map + etag.
--  * google_sync_jobs  — outbound queue (no FK on interview_id so delete jobs
--                        outlive a hard-deleted interview). Hardened: attempts
--                        cap + dead-letter + stale-'processing' reaper.
--  * google_sync_config— single admin row: base_url + push_secret for pg_net.
--
-- PULL is cron-poll only (no events.watch webhook: Google requires a verified
-- callback domain, which *.vercel.app cannot provide). pg_cron hits /api/google/sync
-- every minute; a "Sync now" button and google_diagnostics() are the fallbacks.

-- === google_accounts (per-user OAuth secret; MANY per user) ===
create table if not exists public.google_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  google_sub       text not null,
  email            text,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  scopes           text,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists google_accounts_user_sub_uidx on public.google_accounts (user_id, google_sub);
create index if not exists google_accounts_user_idx on public.google_accounts (user_id, created_at desc);
alter table public.google_accounts enable row level security;
drop policy if exists "google_accounts_owner_all" on public.google_accounts;
create policy "google_accounts_owner_all" on public.google_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Column lockdown: RLS is row-level, so ALSO forbid the client role from reading
-- the token columns (defense-in-depth — tokens are only ever read server-side via
-- the service-role client). Mirrors the 0006 profiles column grant.
revoke select on public.google_accounts from anon, authenticated;
grant select (id, user_id, google_sub, email, enabled, token_expires_at, scopes, created_at, updated_at)
  on public.google_accounts to authenticated;

-- === google_calendars (MANY per account; one push target per user) ===
create table if not exists public.google_calendars (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.google_accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  google_calendar_id text not null,
  summary            text,
  time_zone          text,
  access_role        text,
  selected           boolean not null default false,
  is_push_target     boolean not null default false,
  sync_token         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists google_calendars_cal_uidx on public.google_calendars (account_id, google_calendar_id);
create index if not exists google_calendars_user_idx on public.google_calendars (user_id);
-- Exactly one push target per user:
create unique index if not exists google_calendars_one_push_target_uidx on public.google_calendars (user_id) where is_push_target;
alter table public.google_calendars enable row level security;
drop policy if exists "google_calendars_owner_all" on public.google_calendars;
create policy "google_calendars_owner_all" on public.google_calendars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- === google_event_links (interview <-> event map, per calendar) ===
create table if not exists public.google_event_links (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  interview_id    uuid not null references public.interview_requests(id) on delete cascade,
  calendar_id     uuid not null references public.google_calendars(id) on delete cascade,
  google_event_id text not null,
  html_link       text,
  etag            text,
  sync_status     text not null default 'synced' check (sync_status in ('synced','pending','error','deleted')),
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists google_event_links_interview_cal_uidx on public.google_event_links (interview_id, calendar_id);
create unique index if not exists google_event_links_cal_event_uidx on public.google_event_links (calendar_id, google_event_id);
create index if not exists google_event_links_interview_idx on public.google_event_links (interview_id);
alter table public.google_event_links enable row level security;
drop policy if exists "google_event_links_owner_all" on public.google_event_links;
create policy "google_event_links_owner_all" on public.google_event_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "google_event_links_admin_select" on public.google_event_links;
create policy "google_event_links_admin_select" on public.google_event_links
  for select using (public.is_admin());

-- === google_sync_jobs (outbound queue; NO FK so delete jobs survive) ===
create table if not exists public.google_sync_jobs (
  id           bigint generated always as identity primary key,
  interview_id uuid,                        -- intentionally no FK: must outlive a hard-deleted interview
  op           text not null check (op in ('upsert','delete')),
  reason       text,
  payload      jsonb,                        -- delete snapshot: [{calendar_id, google_event_id}]
  status       text not null default 'pending' check (status in ('pending','processing','done','error','failed')),
  attempts     int not null default 0,
  last_error   text,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists google_sync_jobs_pending_idx on public.google_sync_jobs (status, created_at) where status in ('pending','error');
alter table public.google_sync_jobs enable row level security;
-- RLS on, NO policy => denied to anon/authenticated. Drained by service_role only.

-- === google_sync_config (admin-set base_url + shared secret for pg_net) ===
create table if not exists public.google_sync_config (
  id          boolean primary key default true check (id),
  base_url    text,
  push_secret text,   -- MUST equal the CRON_SECRET env var (kept in two places, like ADMIN_EMAIL)
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.google_sync_config (id) values (true) on conflict (id) do nothing;
alter table public.google_sync_config enable row level security;
drop policy if exists "google_sync_config_admin_all" on public.google_sync_config;
create policy "google_sync_config_admin_all" on public.google_sync_config
  for all using (public.is_admin()) with check (public.is_admin());

-- === PUSH trigger: BEFORE ins/upd/del, loop-guarded, enqueue + best-effort nudge ===
-- BEFORE (not AFTER) so a hard DELETE can still snapshot google_event_links
-- (which cascade-delete with the parent) into the job payload.
create or replace function public.google_sync_on_interview_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_event  boolean;
  v_was_event boolean;
  v_enqueue   text := null;   -- 'upsert' | 'delete' | null
  v_payload   jsonb := null;
  v_cfg       public.google_sync_config;
begin
  -- Loop guard: pull-originated writes set this transaction-local GUC, so we
  -- never bounce a Google-originated change back to Google.
  if coalesce(current_setting('app.google_sync', true), '') = 'on' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.status = 'scheduled' and OLD.scheduled_at is not null then
      v_enqueue := 'delete';
    end if;
  elsif TG_OP = 'INSERT' then
    if NEW.status = 'scheduled' and NEW.scheduled_at is not null then
      v_enqueue := 'upsert';
    end if;
  else -- UPDATE
    v_is_event  := NEW.status = 'scheduled' and NEW.scheduled_at is not null;
    v_was_event := OLD.status = 'scheduled' and OLD.scheduled_at is not null;
    if v_is_event and not v_was_event then
      v_enqueue := 'upsert';
    elsif v_was_event and not v_is_event then
      v_enqueue := 'delete';                       -- cancelled/rejected OR reverted to pending/approved
    elsif v_is_event and v_was_event then
      -- Only fields the Google event actually renders (NOT color: Google uses a
      -- fixed colorId enum, so an app color tag would churn attendees for nothing).
      if NEW.scheduled_at     is distinct from OLD.scheduled_at
      or NEW.duration_minutes is distinct from OLD.duration_minutes
      or NEW.meeting_link     is distinct from OLD.meeting_link
      or NEW.interviewer_id   is distinct from OLD.interviewer_id
      or NEW.role             is distinct from OLD.role
      or NEW.notes            is distinct from OLD.notes
      or NEW.interview_type   is distinct from OLD.interview_type then
        v_enqueue := 'upsert';
      end if;
    end if;
  end if;

  if v_enqueue = 'delete' then
    select jsonb_agg(jsonb_build_object('calendar_id', l.calendar_id, 'google_event_id', l.google_event_id))
      into v_payload
      from public.google_event_links l
     where l.interview_id = coalesce(OLD.id, NEW.id)
       and l.sync_status <> 'deleted';
  end if;

  if v_enqueue is not null then
    insert into public.google_sync_jobs (interview_id, op, reason, payload)
    values (coalesce(NEW.id, OLD.id), v_enqueue, TG_OP || ':' || coalesce(v_enqueue,''), v_payload);

    -- Best-effort nudge so sync happens in seconds. Swallow ALL errors so a
    -- pg_net/config problem never blocks the interview write (telegram pattern).
    begin
      select * into v_cfg from public.google_sync_config where id = true;
      if v_cfg.enabled and v_cfg.base_url is not null then
        perform net.http_post(
          url     := v_cfg.base_url || '/api/google/sync',
          headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_cfg.push_secret,'')),
          body    := jsonb_build_object('source','nudge')
        );
      end if;
    exception when others then null;
    end;
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end$$;

drop trigger if exists on_interview_google_sync on public.interview_requests;
create trigger on_interview_google_sync
  before insert or update or delete on public.interview_requests
  for each row execute function public.google_sync_on_interview_change();

-- === PULL apply (service-role only): loop-guarded writer used by the sync route ===
create or replace function public.google_apply_pull(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_cancel boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Suppress the push trigger for THIS transaction (no bounce back to Google).
  perform set_config('app.google_sync', 'on', true);
  if p_cancel then
    update public.interview_requests
       set status = 'cancelled'
     where id = p_interview_id and status = 'scheduled';
  else
    update public.interview_requests
       set scheduled_at     = coalesce(p_scheduled_at, scheduled_at),
           duration_minutes = coalesce(p_duration_minutes, duration_minutes)
     where id = p_interview_id and status = 'scheduled';
  end if;
end$$;
revoke all on function public.google_apply_pull(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.google_apply_pull(uuid, timestamptz, integer, boolean) to service_role;

-- === Atomic job claim: reaper for stale 'processing', dead-letter, bounded batch ===
create or replace function public.google_claim_sync_jobs(p_limit int default 10)
returns setof public.google_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Requeue jobs whose drain crashed / hit the Vercel timeout (stuck > 5 min);
  -- if they've already used all their attempts, dead-letter instead of requeuing
  -- (otherwise a 5th-attempt timeout would wedge the job in 'pending' forever).
  update public.google_sync_jobs
     set status = case when attempts >= 5 then 'failed' else 'pending' end
   where status = 'processing' and claimed_at < now() - interval '5 minutes';
  -- Dead-letter jobs that keep failing so they stop hammering Google every minute.
  update public.google_sync_jobs
     set status = 'failed'
   where status = 'error' and attempts >= 5;
  return query
  update public.google_sync_jobs j
     set status = 'processing', attempts = attempts + 1, claimed_at = now()
   where j.id in (
     select id from public.google_sync_jobs
      where status in ('pending','error') and attempts < 5
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end$$;
revoke all on function public.google_claim_sync_jobs(int) from public, anon, authenticated;
grant execute on function public.google_claim_sync_jobs(int) to service_role;

-- === Diagnostics (mirrors telegram_diagnostics) ===
create or replace function public.google_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_scheduled boolean := false;
begin
  begin
    select exists(select 1 from cron.job where jobname = 'google-calendar-sync') into v_scheduled;
  exception when others then v_scheduled := false;
  end;
  return jsonb_build_object(
    'pg_net_enabled',  exists(select 1 from pg_extension where extname = 'pg_net'),
    'pg_cron_enabled', exists(select 1 from pg_extension where extname = 'pg_cron'),
    'sync_scheduled',  v_scheduled,
    'pending_jobs',    (select count(*) from public.google_sync_jobs where status in ('pending','error')),
    'failed_jobs',     (select count(*) from public.google_sync_jobs where status = 'failed'),
    'base_url_set',    coalesce((select base_url is not null from public.google_sync_config where id = true), false),
    'secret_set',      coalesce((select push_secret is not null from public.google_sync_config where id = true), false)
  );
end$$;
grant execute on function public.google_diagnostics() to authenticated;

-- === Self-schedule the drain/pull cron (no-op if pg_cron absent) ===
do $$ begin
  perform cron.schedule('google-calendar-sync', '* * * * *', $cron$
    select net.http_post(
      url     := (select base_url from public.google_sync_config where id = true and base_url is not null) || '/api/google/sync',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-sync-secret', (select coalesce(push_secret,'') from public.google_sync_config where id = true)),
      body    := jsonb_build_object('source','cron')
    )
    where exists (select 1 from public.google_sync_config where id = true and enabled and base_url is not null);
  $cron$);
exception when others then null;
end $$;
-- ---- end 0052_google_calendar_sync.sql ----
