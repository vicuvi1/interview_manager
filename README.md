# Interview Manager (Web)

A web application for requesting, scheduling, and managing interviews — built as a
real browser app deployed to the public internet.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase
(Auth + Postgres + Realtime). Deploy target: **Vercel** (app) + **Supabase Cloud**
(backend), both free tier.

> Built so far: **Phase 1 — Candidate dashboard** (`/candidate/dashboard`) and
> **Phase 2 — Admin workspace** (`/admin/dashboard`), plus the email/password auth
> needed to reach them. Calendar/scheduling and payments come in later phases.

---

## What's in these phases

- **Email/password auth** via Supabase Auth (`/login`, sign in + sign up).
- **Candidate dashboard** (`/candidate/dashboard`):
  - Topbar with a Tailwind **segmented role switch** (Candidate / Admin).
  - **Welcome header** — avatar initials, name, email, timezone (from the
    authenticated user + their `profiles` row).
  - **Request an interview** card — a React Hook Form + Zod form (role, preferred
    date/time in the user's timezone, duration, notes) that writes to
    `interview_requests`.
  - **My interviews** card — a styled table of the candidate's own requests, live
    from Supabase, with colored status and payment **pill badges**.
  - **Notifications** card — the candidate's notifications with icons and relative
    timestamps, **live-updating via Supabase Realtime** (no manual refresh).
- **Admin workspace** (`/admin/dashboard`) — only visible to users whose profile
  `role = 'admin'`:
  - **KPI cards** (pending / approved / scheduled / completed).
  - A **live table of every candidate's requests** with candidate identity,
    status + payment badges, and a status filter.
  - A **Manage** modal to **Approve / Reject / Complete / Cancel** a request, with
    an optional message — each action **notifies the candidate in real time**.
  - Admin-aware Row Level Security so admins can see/act on all rows.

---

## Setup

### 1. Create a Supabase project
At [supabase.com](https://supabase.com) → New project (free tier). Wait for it to
provision.

### 2. Create the schema
Open **SQL Editor** in your Supabase project and run, in order:
1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — the
   `profiles`, `interview_requests`, and `notifications` tables with Row Level
   Security, a new-user trigger (auto-creates a profile + welcome notification),
   and Realtime.
2. [`supabase/migrations/0002_admin.sql`](supabase/migrations/0002_admin.sql) — the
   `is_admin()` helper and admin RLS policies for the admin workspace.

**To use the Admin workspace,** make your account an admin (after signing up):
```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```
Then open `/admin/dashboard`.

### 3. (Optional) speed up local testing
**Authentication → Providers → Email**: turn **"Confirm email" off** so sign-up
gives you a session immediately. (With it on, confirm via the emailed link — the
app handles the callback at `/auth/callback`.)

### 4. Configure environment
```bash
cp .env.example .env.local
```
Fill in from **Project Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

### 5. Install & run
```bash
npm install
npm run dev
```
Open <http://localhost:3000> → you'll be sent to `/login`. Sign up, then land on
`/candidate/dashboard`.

---

## Deploy

### Backend
Already live once you've created the Supabase project and run the SQL.

### App → Vercel
1. Push this repo to GitHub (done — `vicuvi1/interview_manager`).
2. On [vercel.com](https://vercel.com): **New Project → import the repo**.
3. Add the two env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy. Add your Vercel URL to Supabase **Authentication → URL Configuration**
   (Site URL + redirect URLs) so email links resolve.

---

## Project layout

```
app/
  layout.tsx                     Root layout (Inter font, globals)
  page.tsx                       -> redirects to /candidate/dashboard
  login/page.tsx                 Auth (Suspense-wrapped login form)
  auth/callback/route.ts         Email-confirm / code exchange
  candidate/dashboard/page.tsx   The candidate dashboard (server-rendered shell)
  admin/dashboard/page.tsx       Placeholder (later phase)
components/
  topbar.tsx, role-switch.tsx, sign-out-button.tsx, welcome-header.tsx
  request-interview-card.tsx     RHF + Zod form
  my-interviews-card.tsx         Live table with badges
  notifications-card.tsx         Realtime notifications
  login-form.tsx
  ui/                            Card, Button, Input/Textarea, Select, Badge, Field, EmptyState
lib/
  supabase/{client,server}.ts    Browser + server Supabase clients (@supabase/ssr)
  env.ts, utils.ts, time.ts, types.ts
middleware.ts                    Session refresh + route protection
supabase/migrations/0001_init.sql
```

## Notes
- All styling is Tailwind utility classes; icons are `lucide-react`. No native
  desktop widgets or unstyled controls.
- RLS ensures each candidate only sees their own data.
- The earlier desktop (Tkinter) and FastAPI versions are gone; they remain in git
  history if ever needed.
