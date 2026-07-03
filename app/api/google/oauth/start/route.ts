import { NextResponse } from "next/server";

import { googleConfigured, redirectUri } from "@/lib/google/config";
import { buildAuthUrl } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kicks off the Google OAuth consent flow for the signed-in user. A user can run
// this repeatedly to link MULTIPLE Google accounts (Google's account chooser).
export async function GET(request: Request) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: "Google isn't configured on the server." }, { status: 500 });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") || "/admin/settings";
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ u: user.id, n: nonce, r: returnTo })).toString("base64url");

  const authUrl = buildAuthUrl(state, redirectUri(url.origin));
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("g_oauth_state", nonce, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
