# Google Calendar sync — setup & how to use

Connect Google Calendar so that **interviews scheduled in the app show up on Google
Calendar automatically**, and **changes you make in Google flow back into the app**.
Everyone (admins and candidates) can connect **one or more** Google accounts and
choose which calendars to sync.

There are two parts: a **one-time setup by the admin** (creating Google credentials),
and then **each person connects their own Google in two clicks**.

---

## Part A — For the user: connect your Google (super easy)

> Only works after the admin has done Part B once. If you don't see a "Connect
> Google account" button, ask your admin to finish setup.

1. Go to **Settings → Google Calendar**.
2. Click **Connect Google account**.
3. Pick your Google account and click **Allow**.
   - You may see an *"unverified app"* screen while the app is new — click
     **Advanced → Go to (app)** to continue. (This goes away once Google verifies
     the app.)
4. Done! Back in Settings you'll see your account listed.
5. Tick the **calendars you want to sync**, and click the **⭐ Set** button on the
   ONE calendar where new interview events should be created ("push target").
6. Want a second Gmail? Click **Connect another Google account** and pick a different
   one. Each is managed separately.

**What you get**
- When an interview is scheduled/rescheduled/cancelled, the event appears/updates/
  disappears on your ⭐ calendar, and the candidate + interviewer get a Google invite.
- If you drag or cancel that event in Google, the app updates to match (within ~1 min,
  or instantly with **Sync now**).
- **Drag-to-move in the app:** on your calendar, click and hold an interview block and
  drag it to a new time. (For candidates this *proposes* the new time to the admin.)

---

## Part B — For the admin: one-time server setup

### 1. Create Google credentials (~5 min)
1. Go to **console.cloud.google.com** → create a project (or pick one).
2. **APIs & Services → Library →** search **Google Calendar API →** **Enable**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External** → fill the app name, your email → Save.
   - **Scopes:** add `.../auth/calendar` and `.../auth/userinfo.email`.
   - **Test users:** add every Gmail you'll connect while the app is unverified
     (Testing mode allows up to 100 and works immediately).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Type: **Web application**.
   - **Authorized redirect URIs →** add:
     `https://YOUR-APP.vercel.app/api/google/oauth/callback`
     (and `http://localhost:3000/api/google/oauth/callback` for local dev).
   - Copy the **Client ID** and **Client secret**.

### 2. Add environment variables (Vercel → Project → Settings → Environment Variables)
```
GOOGLE_CLIENT_ID=...            # from step 1
GOOGLE_CLIENT_SECRET=...        # from step 1
GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-APP.vercel.app/api/google/oauth/callback
CRON_SECRET=<any long random string>
SUPABASE_SERVICE_ROLE_KEY=...   # must be set (Supabase → Settings → API)
```
Redeploy so they take effect. (Mirror them into `.env.local` for local dev.)

### 3. Supabase (one-time)
1. **Database → Extensions:** enable **pg_net** and **pg_cron**.
2. **SQL Editor:** run `apply_all_migrations.sql` (idempotent — installs the Google
   tables + the every-minute sync job).

### 4. Turn it on in the app
1. **Admin → Settings → Google Calendar → Enable server sync.**
   (This points the background job at your site and stores the shared secret — no
   SQL needed.)
2. Check the diagnostics list underneath — everything should be green:
   *server sync configured, pg_net enabled, automatic sync scheduled.*
3. Connect your Google account (Part A) and click **Sync now** to backfill.

---

## How it works (short version)
- **App → Google:** a database trigger notices any interview time/status change and
  queues a job; a background route creates/updates/deletes the Google event. Loop-
  guarded so Google's echo doesn't bounce back.
- **Google → App:** every minute (pg_cron) — and on **Sync now** — the app reads
  incremental changes to *its own* events and updates the interviews. It never touches
  events it didn't create.
- **Storage-light:** we store only IDs, tokens, and a sync cursor — never copies of
  your calendar events (kind to the free Supabase plan).

## Good to know / limits
- **"Unverified app" warning:** normal while new. Add yourself as a **Test user** and
  use *Advanced → Go to app*. To remove the warning for the public, submit the app for
  Google's **sensitive-scope verification** (needs a privacy policy + homepage; takes
  days–weeks). Plan for this before a public launch.
- **Testing mode refresh tokens expire after 7 days** — if sync stops after a week,
  either publish/verify the app, or just reconnect the account. Moving the consent
  screen to **In production** fixes this.
- **Two-way applies to interview events** the app created (identified by a hidden
  `interview_id` tag). Other personal events on your calendar are left untouched.
- **Security:** Google tokens are stored per-user with row-level security and are
  never sent to the browser (same model as the Telegram bot tokens).
