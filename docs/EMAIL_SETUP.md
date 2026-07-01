# Email notifications — setup

Every in-app notification is also emailed to its recipient (confirmations, schedule
updates, payment receipts, new-request alerts, shared feedback, etc.). Delivery runs
in Postgres via **pg_net** calling the **Resend** API — no per-event code.

## 1. Run the migration
Apply `supabase/migrations/0018_email_notifications.sql` (or re-run
`apply_all_migrations.sql`). It creates `app_email_config` and the
`email_on_notification()` trigger.

## 2. Enable pg_net (if not already)
Supabase Dashboard → **Database → Extensions** → enable **pg_net** (the same
extension used by Telegram reminders).

## 3. Get a Resend key
1. Sign up at **resend.com**, create an **API key** (`re_…`).
2. Verify a **sending domain** so you can send from `no-reply@yourdomain.com`.
   (For quick testing, Resend's `onboarding@resend.dev` sender can only email your
   own account address.)

## 4. Configure in the app
**Admin → Settings → Email notifications**: paste the API key, set the **From**
address (e.g. `Interviews <no-reply@yourdomain.com>`), tick **enabled**, **Save**,
then **Send test**.

## Notes
- The API key is stored in `app_email_config` (admin-only RLS) and is **never
  returned to the browser** by the API route.
- Turn emails off any time with the enabled toggle — in-app + Telegram keep working.
