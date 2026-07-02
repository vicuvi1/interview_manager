-- Interview Manager — anti-spam for the public booking link
-- Run AFTER 0040_reconcile_and_resilience.sql.
--
-- Locks down direct anonymous inserts and routes everything through a vetted
-- SECURITY DEFINER RPC that validates input and rate-limits per IP.

alter table public.public_booking_requests add column if not exists ip_hash text;

-- No more direct anon/authenticated inserts — the RPC below is the only way in.
drop policy if exists "pbr_insert_anyone" on public.public_booking_requests;
revoke insert on public.public_booking_requests from anon;
revoke insert on public.public_booking_requests from authenticated;

create or replace function public.submit_public_booking(
  p_name         text,
  p_email        text,
  p_role         text,
  p_preferred_at timestamptz default null,
  p_timezone     text default null,
  p_notes        text default null,
  p_ip_hash      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  -- Basic validation (server-side, not bypassable by a crafted client).
  if length(coalesce(btrim(p_name), '')) < 2 then raise exception 'INVALID_NAME'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if length(coalesce(btrim(p_role), '')) < 2 then raise exception 'INVALID_ROLE'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'INVALID_NOTES'; end if;

  -- Rate limit: at most 5 submissions per IP per hour.
  if p_ip_hash is not null then
    select count(*) into recent
    from public.public_booking_requests
    where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if recent >= 5 then raise exception 'RATE_LIMIT'; end if;
  end if;

  insert into public.public_booking_requests (name, email, role, preferred_at, timezone, notes, ip_hash)
  values (
    btrim(p_name),
    lower(btrim(p_email)),
    btrim(p_role),
    p_preferred_at,
    p_timezone,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_ip_hash
  );
end;
$$;

revoke all on function public.submit_public_booking(text, text, text, timestamptz, text, text, text) from public;
grant execute on function public.submit_public_booking(text, text, text, timestamptz, text, text, text) to anon, authenticated;
