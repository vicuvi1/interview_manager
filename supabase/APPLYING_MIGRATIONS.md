# Applying database migrations

Schema changes live as numbered files in `supabase/migrations/` (e.g.
`0067_interview_materials_and_sent.sql`). They are **not** applied by the Vercel
deploy — you apply them to the Supabase Postgres database once per change.

Pick whichever is easiest:

## Option A — Supabase CLI (recommended)

One command, applies only the migrations the database hasn't seen yet:

```bash
npm run db:push        # == supabase db push
```

First-time setup (once):

```bash
npm i -g supabase           # or: brew install supabase/tap/supabase
supabase link --project-ref <your-project-ref>   # from the Supabase dashboard URL
```

## Option B — psql one-liner

Runs the concatenated `apply_all_migrations.sql`. Every migration is written to
be idempotent (`create ... if not exists`, `create or replace`, `add column if
not exists`), so re-running is safe.

```bash
export DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
npm run db:apply
```

Get the connection string from **Supabase → Project Settings → Database →
Connection string (URI)**.

## Option C — Supabase SQL editor (no tooling)

Open **Supabase → SQL Editor**, paste the contents of the **newest** numbered
file in `supabase/migrations/` (or the whole `apply_all_migrations.sql`), and Run.

---

**Rule of thumb:** after I add a migration, run one of the above before testing
the new feature — otherwise the UI will call functions/columns that don't exist
yet.
