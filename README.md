# Interview Manager

A small but complete **interview scheduling & management system** built with
FastAPI. Candidates request interviews; a single admin (the **"caller"**)
approves, schedules, conducts, and tracks every interview through its lifecycle.
Timezone-aware scheduling, candidate management, mock payments, and an in-app
notification feed are all included.

> Tech stack: **Python · FastAPI · SQLAlchemy 2 · SQLite** + a dependency-free
> HTML/JS frontend.

---

## Features

- **Candidate portal** — sign in by email, request an interview (with optional
  preferred time), track status, read notifications, and pay invoices.
- **Admin dashboard** — one caller manages everything: approve / reject /
  schedule / start / complete / cancel, raise invoices, and keep private notes.
- **Timezone-aware** — every time is stored in UTC and shown back to each
  candidate in *their own* IANA timezone. No more "wait, whose 3 PM?".
- **Interview lifecycle** — a guarded state machine; illegal transitions return
  `409` instead of corrupting state.
- **Payments** — a mock provider (invoice → pay → refund). Swap one function to
  go live with Stripe/PayPal.
- **Notifications** — candidates and the admin each get an in-app feed, written
  automatically on every lifecycle event.

## Interview lifecycle

```
requested ──approve──► approved ──schedule──► scheduled ──start──► in_progress ──complete──► completed
    │                     │                       │                     │
    └─reject─► rejected    └─cancel/reject         └─cancel              └─cancel ─► cancelled
```

Transitions are enforced in [`app/lifecycle.py`](app/lifecycle.py).

---

## Quick start

```bash
# 1. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure (optional but recommended)
copy .env.example .env       # then edit ADMIN_API_KEY
# cp .env.example .env        # macOS/Linux

# 4. Run
python run.py                # or: uvicorn app.main:app --reload
```

Then open:

| URL | What |
| --- | --- |
| http://127.0.0.1:8000/ | Candidate portal |
| http://127.0.0.1:8000/admin.html | Admin dashboard (needs the admin key) |
| http://127.0.0.1:8000/docs | Interactive API docs (Swagger UI) |
| http://127.0.0.1:8000/health | Health check |

The admin dashboard asks for your `ADMIN_API_KEY` (default `change-me-admin-key`
— **change it** in `.env`). It is stored only in your browser and sent as the
`X-Admin-Key` header.

## Running the tests

```bash
pytest
```

The suite (in [`tests/`](tests/)) covers candidate registration & validation,
the full interview lifecycle, illegal-transition guarding, admin auth, the
payment flow, and timezone conversion. Each test runs against a throwaway SQLite
database.

---

## Project layout

```
app/
  main.py           FastAPI app: routers + static frontend + health
  config.py         Settings (env / .env)
  database.py       Engine, session, declarative Base
  models.py         Candidate, Interview, Payment, Notification
  schemas.py        Pydantic request validation
  serializers.py    Response dicts (incl. timezone-localized fields)
  lifecycle.py      Interview status state machine
  timezone.py       UTC <-> local helpers
  notifications.py  In-app notification service
  deps.py           Admin auth + shared 404 lookups
  routers/          candidates, interviews, payments, notifications
  static/           index.html (portal), admin.html (dashboard), JS, CSS
tests/              pytest suite
run.py              Dev-server launcher
```

## API overview

Candidate-facing (no auth):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/candidates` | Register / sign in by email |
| `GET` | `/api/candidates/by-email?email=` | Look up a candidate |
| `POST` | `/api/interviews` | Request an interview |
| `GET` | `/api/interviews/by-candidate/{id}` | A candidate's interviews |
| `GET` | `/api/candidates/{id}/notifications` | Candidate notification feed |
| `POST` | `/api/payments/{id}/pay` | Pay an invoice (mock) |

Admin-only (require `X-Admin-Key`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/interviews?status=` | List / filter interviews |
| `POST` | `/api/interviews/{id}/approve` \| `/reject` \| `/schedule` \| `/start` \| `/complete` \| `/cancel` | Lifecycle actions |
| `PATCH` | `/api/interviews/{id}/admin-notes` | Private notes |
| `POST` | `/api/interviews/{id}/payment` | Raise an invoice |
| `POST` | `/api/payments/{id}/refund` | Refund |
| `GET` | `/api/payments` | List payments |
| `GET` | `/api/admin/notifications` | Admin notification feed |

See `/docs` for the full, interactive specification.

---

## Notes & next steps

This is a working scaffold. For production you'd typically add: real
authentication for candidates (currently identified by email), Alembic
migrations instead of `create_all`, a real payment gateway and email/SMS
notifications (both isolated to one module each), and rate limiting.
