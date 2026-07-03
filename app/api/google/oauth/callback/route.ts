import { NextResponse } from "next/server";

import { redirectUri } from "@/lib/google/config";
import { decodeIdToken, exchangeCode, fetchUserInfo } from "@/lib/google/oauth";
import { listCalendarList } from "@/lib/google/calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StateShape {
  u: string;
  n: string;
  r: string;
}

function parseState(raw: string | null): StateShape | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StateShape;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const state = parseState(url.searchParams.get("state"));
  const returnTo = state?.r && state.r.startsWith("/") ? state.r : "/admin/settings";
  const back = (status: string) => NextResponse.redirect(`${origin}${returnTo}?google=${status}`);

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code || !state) return back("error");

  // CSRF: the nonce cookie must match the state, and the state user must be the session user.
  const cookieNonce = request.headers.get("cookie")?.match(/(?:^|;\s*)g_oauth_state=([^;]+)/)?.[1];
  if (!cookieNonce || cookieNonce !== state.n) return back("error");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.u) return back("error");

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri(origin));
  } catch {
    return back("error");
  }

  const idInfo = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
  const info = idInfo.sub ? idInfo : await fetchUserInfo(tokens.access_token);
  if (!info.sub) return back("error");

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  // Token columns are service-role-only; read/write them with the admin client
  // (scoped by user_id). Falls back to the session client on first connect if the
  // service key isn't set — the write still works, only the preserve-read is skipped.
  const db = createAdminClient() ?? supabase;

  // Preserve an existing refresh_token — Google omits it on re-consent.
  const { data: existing } = await db
    .from("google_accounts")
    .select("id, refresh_token")
    .eq("user_id", user.id)
    .eq("google_sub", info.sub)
    .maybeSingle();
  const refresh = tokens.refresh_token || (existing as { refresh_token?: string } | null)?.refresh_token || null;

  const { data: acct, error: acctErr } = await db
    .from("google_accounts")
    .upsert(
      {
        user_id: user.id,
        google_sub: info.sub,
        email: info.email ?? null,
        access_token: tokens.access_token,
        refresh_token: refresh,
        token_expires_at: expiresAt,
        scopes: tokens.scope ?? null,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,google_sub" },
    )
    .select("id")
    .single();
  if (acctErr || !acct) return back("error");
  const accountId = (acct as { id: string }).id;

  // Discover calendars (best-effort). Store IDs only — no event data (free plan).
  try {
    const cals = await listCalendarList(tokens.access_token);
    for (const c of cals) {
      await supabase.from("google_calendars").upsert(
        {
          account_id: accountId,
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
    // If the user has no push target yet, default to this account's primary calendar.
    const { data: hasTarget } = await supabase
      .from("google_calendars")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_push_target", true)
      .maybeSingle();
    if (!hasTarget) {
      const primary = cals.find((c) => c.primary) ?? cals[0];
      if (primary) {
        await supabase
          .from("google_calendars")
          .update({ selected: true, is_push_target: true })
          .eq("account_id", accountId)
          .eq("google_calendar_id", primary.id);
      }
    }
  } catch {
    /* calendars can be refreshed later from Settings */
  }

  const res = back("connected");
  res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
