# QA checklist — Interview Scheduler Pro

A manual end-to-end pass to run against the live Supabase project after deploying.
Every migration (`0001`–`0012`, or `apply_all_migrations.sql`) must be applied first,
and `SUPABASE_SERVICE_ROLE_KEY` set in the environment for admin-code promotion.

Legend: ☐ = to verify.

## Setup / access
- ☐ Sign up as a **candidate** (no access code) → lands on `/candidate/dashboard`.
- ☐ Sign up / promote an **admin** using the access code → lands on `/admin/dashboard`.
- ☐ A candidate hitting any `/admin/*` route sees the "access required" screen, not admin data.
- ☐ Signing out from the sidebar account menu returns to `/login`.

## Candidate flow
- ☐ **Book** (`/candidate/book`): submit a request → toast, and it appears on the dashboard + `/candidate/interviews` instantly (Realtime).
- ☐ Times render in the candidate's profile timezone; changing timezone under Profile re-renders them.
- ☐ **Dashboard hero**: once an interview is scheduled by an admin, the hero shows it with a live countdown; the Join button pulses within 10 minutes of start.
- ☐ **Pay**: when an admin invoices a request, a Pay button appears (dashboard + interviews). Paying flips it to "paid".
- ☐ **Cancel**: a pending/approved/scheduled request can be cancelled; completed/cancelled cannot.
- ☐ **Notifications**: approvals/schedules/payments arrive as a bell toast; the inbox marks read, filters, deletes, and clears.
- ☐ **Support** FAQ expands; the email link opens a pre-filled message.

## Admin flow
- ☐ **Dashboard**: KPIs, pending requests, calendar widget, and activity all populate.
- ☐ **Requests console** (`/admin/requests`): status-filter chips + counts, search, per-row Manage.
  - ☐ **Bulk**: select rows → Approve / Complete / Cancel / Force status; with "Notify" on, candidates get a notification.
  - ☐ **New booking**: creates a scheduled request for a candidate and notifies them.
  - ☐ **Schedule / Reschedule**: slot grid respects availability windows, disables past/conflicting slots, shows both timezones, assigns an interviewer, and generates a link.
- ☐ **Calendar** (`/admin/calendar`): interviews + availability/busy/event blocks render; drag a scheduled interview → confirm + notify reschedules it; clicking a slot lets you delete it.
- ☐ **Candidates** (`/admin/candidates`): directory search/sort; a detail page shows history, payments, private notes (admin-only), and timeline.
- ☐ **Payments** (`/admin/payments`): outstanding invoices → Mark paid notifies the candidate and moves it to "recently paid".
- ☐ **Revenue** (`/admin/revenue`): KPIs, leaderboard, method + monthly charts, ledger; Mark paid / Add payment / receipt work.
- ☐ **Analytics** (`/admin/analytics`): funnel is non-increasing, status/role bars and 6-month trends match the data.
- ☐ **Interviewers** (`/admin/interviewers`): each admin shows Assigned / Upcoming / Completed counts after you assign interviewers.
- ☐ **Activity** (`/admin/activity`): every status/schedule/payment change appears with actor + time, live.
- ☐ **Booking links** copy to clipboard.

## Cross-cutting
- ☐ Two browsers (admin + candidate): an admin action reflects on the candidate side within a second or two (Realtime).
- ☐ No console errors on any page; no light backgrounds anywhere (dark theme everywhere).
- ☐ Mobile width: sidebar collapses to a drawer; tables scroll horizontally.

## Security spot-checks
- ☐ In the candidate session, a direct read of another user's `interview_requests` / `payments` / `notifications` returns nothing (RLS).
- ☐ `candidate_notes` and `audit_log` are unreadable to candidates.
- ☐ The admin access code never appears in the client bundle (verified server-side only).
