import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { icsFeed } from "@/lib/calendar-invite";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface FeedRow {
  id: string;
  role: string;
  scheduled_at: string;
  duration_minutes: number;
  meeting_link: string | null;
}

/**
 * Live .ics subscription feed of a candidate's scheduled interviews.
 * Unauthenticated by design (calendar apps can't log in) — access is gated by
 * the unguessable per-user token via the SECURITY DEFINER `ics_feed` RPC.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return new Response("Missing token", { status: 400 });

  // Defense-in-depth against abusive polling (the token itself is the real gate).
  if (!rateLimit(`ics:${clientIp(req)}`, 60, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("ics_feed", { p_token: token });
  if (error) return new Response("Feed unavailable", { status: 500 });

  const events = ((data as FeedRow[] | null) ?? []).map((r) => ({
    title: `Interview: ${r.role}`,
    startISO: r.scheduled_at,
    durationMin: r.duration_minutes || 30,
    location: r.meeting_link,
    details: r.meeting_link ? `Join: ${r.meeting_link}` : null,
  }));

  return new Response(icsFeed(events, "My interviews"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="interviews.ics"',
      // Short CDN cache: calendar apps poll often; the token is in the URL so
      // each candidate's feed caches separately.
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
