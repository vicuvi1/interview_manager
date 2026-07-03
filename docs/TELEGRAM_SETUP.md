# Telegram interview reminders — setup

Each admin connects **their own** Telegram bot and picks how many minutes before an
interview to be reminded. A Postgres cron job checks every minute and sends any due
reminders via the Telegram Bot API. Nothing here needs extra environment variables —
tokens are stored per-admin in the database (RLS keeps each token private to its owner).

## Immediate event notifications (admins **and** candidates)

Beyond scheduled reminders, **every** in-app notification — a new request, an
approve/reject, a reschedule or cancellation (from either side), a reported payment —
is forwarded to Telegram **instantly** by a database trigger (`telegram_on_notification`).
Both admins and candidates can connect their own bot (Admin/Candidate →
**Settings → Telegram**).

This forwarding runs **inside Postgres via `pg_net`**, so **`pg_net` must be enabled**
(step 2 below) or messages silently never send even though the in-app bell still works.
The **"Send test"** button only checks the bot from the web server, so it can pass while
real notifications don't arrive — use **"Run diagnostics"** on the Telegram settings card
to see exactly what's missing (forwarding trigger installed? pg_net on? bot connected?).

## 1. Run the migration
Apply `supabase/migrations/0014_telegram_reminders.sql` (or re-run
`apply_all_migrations.sql`). This creates `telegram_settings`, `reminder_log`, and the
`process_interview_reminders()` function. Re-running `apply_all_migrations.sql` is
idempotent and also installs the forwarding trigger and `telegram_diagnostics()`.

## 2. Enable the two extensions (one-time)
Supabase Dashboard → **Database → Extensions**, enable:
- **pg_net** — lets Postgres make the outbound HTTPS call to Telegram.
- **pg_cron** — runs the check every minute.

## 3. Schedule the job (one-time)
Supabase Dashboard → **SQL Editor**, run:
```sql
select cron.schedule(
  'interview-reminders',
  '* * * * *',
  $$ select public.process_interview_reminders(); $$
);
```
To pause it later: `select cron.unschedule('interview-reminders');`

You can send a reminder pass manually to test wiring:
```sql
select public.process_interview_reminders();  -- returns how many were sent
```

## 4. Connect a bot (per admin, in the app)
1. In Telegram, open **@BotFather** → `/newbot`, follow the prompts, copy the **token**.
2. Open your new bot and press **Start** (send `/start`) so it's allowed to message you.
3. In the app: **Admin → Settings → Telegram reminders** → paste the token → **Connect bot**.
4. If it says "action needed", press **Detect chat** after you've sent `/start`.
5. Choose **Remind me before** (e.g. 15 minutes), keep **Reminders enabled**, **Save**, and **Send test** to confirm.

## How it works
- Every minute the job looks for `scheduled` interviews starting within each admin's
  chosen window that haven't been reminded yet, sends a Telegram message, and records
  it in `reminder_log` (so you never get a duplicate).
- Times in the message use the admin's profile timezone.
- Every connected admin is reminded of every upcoming interview. (Scoping reminders to
  the assigned interviewer only is a small future tweak.)

## Security notes
- Bot tokens live in `telegram_settings` with RLS `auth.uid() = user_id` — only the
  owning admin can read their token; it is never returned to the browser by the API.
- `process_interview_reminders()` is `SECURITY DEFINER` and execute is revoked from
  all client roles; only the cron job runs it.
