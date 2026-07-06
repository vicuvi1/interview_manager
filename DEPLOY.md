# Deploy & auto-update

Two ways to run Interview Manager. Both auto-update from GitHub.

---

## A. Run locally — one click (auto-updates while running)

**Double-click `Start Interview Manager.bat`.**

It will:
1. **install Node.js and Git for you** (via `winget`) if they're missing,
2. create `.env.local` from the template on first run (it opens so you can paste
   your Supabase URL + anon key),
3. `git pull` the latest code,
4. **install all dependencies** (`npm install` runs every launch),
5. start the app, wait until it's ready, and open it in your browser
   (picks a free port automatically),
6. then **check GitHub every 60 seconds** and live-reload whenever you push an
   update — no restart needed.

No prerequisites to install by hand on Windows 10/11 (which ships `winget`). On
older systems, install [Node.js LTS](https://nodejs.org) once and re-run. Without
Git it still runs, just without auto-update.

---

## B. Deploy on the public internet — Vercel (auto-deploys on every push)

This is the real "the website updates itself whenever GitHub updates" setup: it's
free, always-on, and **redeploys automatically on every push to `main`**.

1. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import
   `vicuvi1/interview_manager` (authorize GitHub if asked).
2. Vercel auto-detects Next.js — leave the build settings as-is.
3. Add **Environment Variables** (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**.
5. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to
   your Vercel URL and add it to **Redirect URLs** (so email links resolve).

From then on: **every `git push` to `main` triggers an automatic build + deploy.**
Pull requests get their own preview URLs. Nothing else to do.

> The included GitHub Actions workflow (`.github/workflows/ci.yml`) builds the app
> on every push/PR so a broken change is caught before it ships.

---

## Database

Before either option works, run the schema once in your Supabase project (SQL
Editor): paste **`apply_all_migrations.sql`** — every migration
(`supabase/migrations/0001…0059`) concatenated in order, safe to re-run. See the
main [README](README.md) for details.
