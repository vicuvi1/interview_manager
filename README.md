# Interview Manager

A full web app for requesting, scheduling, running, and getting paid for
interviews — with a candidate portal, an admin workspace, real-time updates, and
Telegram / Google Calendar / email integrations. Deployed to the public internet.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase
(Auth + Postgres + Realtime + Storage) · FullCalendar · Luxon · React Hook Form +
Zod · lucide-react.
**Deploy target:** Vercel (app) + Supabase Cloud (backend) — both free tier.

---

## Features

### Candidate portal (`/candidate/*`)
- **Request an interview** — a rich React Hook Form + Zod form: role, interview
  type, level, format (video / phone / in-person), focus areas, goals, preferred
  date/time (in the candidate's timezone), duration, notes, and **file
  attachments** (stored in a private Supabase Storage bucket).
- **My interviews** — a live table of the candidate's requests with status and
  payment badges, join links, and calendar (.ics) invites.
- **Self-serve reschedule** — the candidate proposes a new time; it shows as
  *reschedule pending* until the admin accepts or declines.
- **Edit details / meeting link / cancel** — while a request is still open.
- **Booking** — book directly against an admin's published availability, via a
  **public booking link**, or with reusable **booking profiles**; share your own
  availability.
- **Calendar** (`/candidate/calendar`) — a month calendar of confirmed
  interviews in the candidate's timezone, plus an Upcoming list, live via Realtime.
- **Payments** — pay by crypto to a listed wallet and report the amount; the
  payment badge flips to *paid* once the admin confirms.
- **Notifications center** — realtime, no manual refresh.
- **Resume library, feedback widget, and settings** — timezone, email
  preferences, and Telegram linking.

### Admin workspace (`/admin/*`)
- **Dashboard** — KPI cards and an *attention* feed (pending approvals,
  reschedule proposals, unpaid invoices, delivery blockers).
- **Requests console + Manage dialog** — approve / reject / complete / cancel,
  invoice, and **accept or decline candidate reschedule proposals**, each
  notifying the candidate in real time.
- **Schedule dialog** — pick a time constrained to your published availability,
  with conflict detection against other scheduled interviews, a live
  candidate-timezone preview, interviewer assignment, and meeting-link generation.
- **Calendar board** — all candidates' scheduled interviews (admin timezone),
  colored by interviewer / type, with an interviewer "people" filter.
- **Candidates** — list + detail with private admin notes and a stage tracker.
- **Analytics, Revenue & Payments** — funnel/analytics board, revenue board, and
  a crypto **wallets manager**.
- **Interviewers, Feedback inbox, Booking links, Storage board.**
- **Settings** — interview-type styles, per-stage pricing, configurable request
  fields, templates, data retention, and the Telegram / email / Google Calendar
  integrations.

### Integrations
- **Telegram** — bot reminders, slash commands, an inbound webhook, and
  self-diagnostics (`/api/telegram/*`).
- **Google Calendar** — OAuth connect + two-way sync (`/api/google/*`).
- **Email** — transactional notifications with per-user preferences.
- **Scheduled jobs** — reminders and digests driven by Postgres `pg_cron` /
  `pg_net` (the admin dashboard warns if they're disabled).

### Auth & access
- Email/password via Supabase Auth (`/login`, sign in + sign up, password reset).
- Admin unlock via a server-checked **access code** (`ADMIN_ACCESS_CODE`), plus an
  **auto-admin** email configured in [`lib/constants.ts`](lib/constants.ts).
- Admin-aware **Row Level Security** throughout — candidates only ever see their
  own rows.

---

## Run it

### Locally (one click, auto-updating)
Double-click **`Start Interview Manager.bat`**. It installs Node.js + Git via
`winget` if missing, creates `.env.local` from the template on first run, installs
dependencies, opens the app on a free port, and **auto-updates from GitHub every
60 s**. See **[DEPLOY.md](DEPLOY.md)** for details.

### Manually
```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm test` (Vitest).

---

## Setup

### 1. Create a Supabase project
At [supabase.com](https://supabase.com) → New project (free tier).

### 2. Create the schema
Open the **SQL Editor** and run **[`apply_all_migrations.sql`](apply_all_migrations.sql)**
— it's every migration (`supabase/migrations/0001…0059`) concatenated in order and
is safe to re-run (idempotent guards throughout). To grant admin to any account
after sign-up:
```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### 3. Configure environment
Copy `.env.example` → `.env.local` and fill in:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/publishable key |
| `ADMIN_ACCESS_CODE` | ✅ | Code users type to unlock the Admin role |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side admin grants + Google sync (never expose) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | optional | Google Calendar sync |
| `CRON_SECRET` | for jobs | Gates the internal sync/cron endpoints |

> Tip: for fast local testing, turn **Authentication → Providers → Email →
> "Confirm email" off** so sign-up gives you a session immediately.

---

## Deploy

Deploy the app to **Vercel** (import `vicuvi1/interview_manager`, add the env
vars, Deploy) — it then auto-deploys on every push to `main`. Add your Vercel URL
to Supabase **Authentication → URL Configuration**. Full walkthrough in
**[DEPLOY.md](DEPLOY.md)**.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `lint`, `test`,
and `build` on every push/PR.

---

## Project layout

```
app/
  candidate/…            Dashboard, calendar, booking, payments, notifications, settings, support
  admin/…                Dashboard, requests, calendar, candidates, analytics, revenue,
                         payments, interviewers, feedback, booking-links, storage, settings
  api/…                  telegram/, google/, email/, public-booking/, admin/, verify-admin-code
  auth/callback, login, reset-password, book (public)
components/
  candidate/  admin/  calendar/  shell/  ui/  …   (feature + design-system components)
lib/
  supabase/{client,server,admin}.ts   Browser / server / service-role clients
  time.ts                DST-safe wall-time ⇄ UTC conversion (see tests/unit/time.test.ts)
  slots.ts, calendar*.ts Availability, recurrence, conflict detection
  google/, email.ts, notifications.ts, payments.ts, analytics.ts, …
supabase/migrations/     0001 … 0059  (bundled in apply_all_migrations.sql)
tests/unit/              Vitest unit tests
middleware.ts            Session refresh + route protection
```

## Testing

`npm test` runs the Vitest suite. Timezone/DST conversions in
[`lib/time.ts`](lib/time.ts) are covered by boundary-case tests in
[`tests/unit/time.test.ts`](tests/unit/time.test.ts), including both US and EU
DST transitions and a round-trip property test.

## Notes
- Styling is Tailwind utility classes; icons are `lucide-react`. No unstyled controls.
- Payments are **crypto-wallet based** (candidate reports the amount, admin
  confirms) — there is no card processor wired up.
- Earlier desktop (Tkinter) and FastAPI versions live only in git history.
