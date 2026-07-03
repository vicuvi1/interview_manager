import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth";
import { CRON_SECRET, googleConfigured } from "@/lib/google/config";
import { listCalendarList } from "@/lib/google/calendar";
import { getValidAccessToken, type GoogleAccountRow } from "@/lib/google/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return ctx.error;
  const { supabase, user } = ctx;

  const [{ data: accounts }, { data: calendars }, { data: diag }, { data: profileRow }] = await Promise.all([
    supabase.from("google_accounts").select("id, email, enabled, created_at").eq("user_id", user.id).order("created_at"),
    supabase
      .from("google_calendars")
      .select("id, account_id, summary, selected, is_push_target")
      .eq("user_id", user.id)
      .order("summary"),
    supabase.rpc("google_diagnostics"),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);

  const isAdmin = isAdminUser(profileRow as Profile | null, user.email);

  return NextResponse.json({
    configured: googleConfigured(),
    isAdmin,
    accounts: accounts ?? [],
    calendars: calendars ?? [],
    diagnostics: diag ?? null,
  });
}

export async function POST(request: Request) {
  const ctx = await requireUser();
  if ("error" in ctx) return ctx.error;
  const { supabase, user } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = body?.action as string;

  if (action === "toggle-selected") {
    const { error } = await supabase
      .from("google_calendars")
      .update({ selected: body?.selected !== false, updated_at: new Date().toISOString() })
      .eq("id", String(body?.calendarId))
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "set-push-target") {
    // Exactly one push target per user — clear the others first (partial unique index).
    await supabase.from("google_calendars").update({ is_push_target: false }).eq("user_id", user.id);
    const { error } = await supabase
      .from("google_calendars")
      .update({ is_push_target: true, selected: true, updated_at: new Date().toISOString() })
      .eq("id", String(body?.calendarId))
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "refresh-calendars") {
    // Tokens are only readable via the service-role client (owner still enforced
    // by the explicit user_id filter below).
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Server key not configured." }, { status: 500 });
    const { data: acctRow } = await admin
      .from("google_accounts")
      .select("id, user_id, email, access_token, refresh_token, token_expires_at, enabled")
      .eq("id", String(body?.accountId))
      .eq("user_id", user.id)
      .maybeSingle();
    const account = acctRow as GoogleAccountRow | null;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const token = await getValidAccessToken(account, admin);
    if (!token) return NextResponse.json({ error: "Reconnect this Google account." }, { status: 400 });
    const cals = await listCalendarList(token);
    for (const c of cals) {
      await supabase.from("google_calendars").upsert(
        {
          account_id: account.id,
          user_id: user.id,
          google_calendar_id: c.id,
          summary: c.summary ?? null,
          time_zone: c.timeZone ?? null,
          access_role: c.accessRole ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,google_calendar_id" },
      );
    }
    return NextResponse.json({ ok: true, count: cals.length });
  }

  if (action === "disconnect-account") {
    // Cascade removes calendars + event links. (Any events already created in
    // Google are left as-is; disconnecting revokes our token so we can't delete them.)
    const { error } = await supabase
      .from("google_accounts")
      .delete()
      .eq("id", String(body?.accountId))
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "init-sync-config") {
    // Admin one-click: point pg_net at this deployment and set the shared secret
    // to the server's CRON_SECRET — kept server-side so it never drifts / leaks.
    const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (!isAdminUser(profileRow as Profile | null, user.email)) {
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }
    if (!CRON_SECRET) {
      return NextResponse.json({ error: "Set the CRON_SECRET env var on the server first." }, { status: 400 });
    }
    const origin = new URL(request.url).origin;
    const { error } = await supabase
      .from("google_sync_config")
      .update({ base_url: origin, push_secret: CRON_SECRET, enabled: true, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, baseUrl: origin });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
