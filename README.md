# Interview Manager

A **local, server-less interview scheduling & management app**. Candidates
request interviews; a single admin (the **"caller"**) approves, schedules,
conducts, and tracks each one. It runs as a **native desktop window** (Python's
built-in Tkinter) — no web server, no browser. Candidate and Admin modes talk to
each other through a **shared local SQLite database** on your machine.

Comes with a **one-click launcher/updater** that installs everything and starts
the app.

> Tech stack: **Python · Tkinter (stdlib) · SQLAlchemy 2 · SQLite**. The only
> installed dependencies are SQLAlchemy and `tzdata`.

---

## Easiest way to run

**Double-click `Start Interview Manager.bat`** (Windows).

That opens the **Launcher**, which automatically:
1. pulls the latest code from GitHub (if this folder is a git clone),
2. creates a local virtual environment,
3. installs/updates the requirements,

then enables **Launch App**. Click it and the desktop app opens.

You can re-open the launcher any time to update + relaunch.

## Run it manually

```bash
python -m venv venv
venv\Scripts\activate        # Windows  (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
python run_app.py            # opens the desktop window
```

Or just `python launcher.py` to get the launcher UI.

---

## Using the app

The window has two modes, toggled top-right:

- **Candidate** — sign in by name + email + timezone, request an interview
  (optionally a preferred time in *your* timezone), watch its status, read
  notifications, and pay an invoice.
- **Admin** — enter the admin password (default **`admin`**), then drive each
  interview: **Approve · Reject · Schedule · Start call · Complete · Cancel**,
  raise an **Invoice**, and keep private **Notes**.

Both modes share one database, so a request made as a candidate shows up for the
admin (and approvals/schedules flow back) — the views auto-refresh every few
seconds. You can even open the app twice (once per role) and they stay in sync.

### How candidate ↔ admin "communicate" without a server

Everything is persisted to a single SQLite file and every action is a short
transaction against it. There is no network service — the shared file *is* the
channel. The database lives at (override with the `IM_DATABASE_URL` env var):

```
%LOCALAPPDATA%\InterviewManager\interview_manager.db   (Windows)
~/.local/share/InterviewManager/interview_manager.db   (macOS/Linux)
```

### Interview lifecycle

```
requested ──approve──► approved ──schedule──► scheduled ──start──► in_progress ──complete──► completed
    │                     │                       │                     │
    └─reject─► rejected    └─cancel/reject         └─cancel              └─cancel ─► cancelled
```

Illegal transitions are refused (enforced in [`app/lifecycle.py`](app/lifecycle.py)).

---

## Configuration

All optional — sensible defaults mean it works with zero config. Set env vars to
override:

| Variable | Default | Meaning |
| --- | --- | --- |
| `IM_ADMIN_PASSWORD` | `admin` | Password to enter Admin mode |
| `IM_DATABASE_URL` | per-user SQLite file | SQLAlchemy database URL |
| `IM_DEFAULT_TIMEZONE` | `UTC` | Prefilled timezone for new candidates |
| `IM_APP_NAME` | `Interview Manager` | Window title |

## Tests

```bash
pytest
```

Covers candidate registration/validation, the full interview lifecycle,
illegal-transition guarding, payments, admin auth, and timezone conversion —
all against the service layer with a throwaway SQLite database.

## Project layout

```
launcher.py                 Launcher/updater mini-app (stdlib only)
Start Interview Manager.bat  Double-click entry point for the launcher
run_app.py                  Starts the desktop app
app/
  config.py                 Settings + per-user database location
  database.py               Engine, session_scope(), init_db()
  models.py                 Candidate, Interview, Payment, Notification
  service.py                All business operations (the GUI calls these)
  lifecycle.py              Interview status state machine
  timezone.py               UTC <-> local helpers
  notifications.py          In-app notification writer
  serializers.py            ORM -> plain dicts (with localized times)
gui/
  app.py                    Main window + mode toggle + auto-refresh
  candidate.py              Candidate view
  admin.py                  Admin view
  common.py                 Shared widget helpers
tests/                      pytest suite (service + timezone)
```

---

## Notes & next steps

This is a working local app. Natural next steps: package it into a single `.exe`
with PyInstaller (the launcher already isolates the runtime), add candidate
authentication, swap the mock payment step for a real provider (isolated to
`app/service.py`), and move from `create_all` to Alembic migrations.

> Earlier this project was a FastAPI web app; that version lives in git history
> at commit `3e89667` if you ever want the browser-based interface back.
