import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { vetSubmission } from "@/lib/public-booking";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const vetted = vetSubmission(body ?? {});
  if (!vetted.ok) {
    // Bot-like → pretend success so we don't tip them off; else a real error.
    return vetted.drop
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: vetted.error }, { status: 400 });
  }
  const v = vetted.values;

  // Hash the client IP for per-IP rate limiting (no raw IP stored).
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const ipHash = createHash("sha256").update(`${ip}|pbr`).digest("hex");

  const supabase = createClient();
  const { error } = await supabase.rpc("submit_public_booking", {
    p_name: v.name,
    p_email: v.email,
    p_role: v.role,
    p_preferred_at: v.preferred_at,
    p_timezone: v.timezone,
    p_notes: v.notes,
    p_ip_hash: ipHash,
  });

  if (error) {
    if (error.message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "You've sent several requests already — please try again later." },
        { status: 429 },
      );
    }
    if (error.message.startsWith("INVALID_")) {
      return NextResponse.json({ error: "Please check your details and try again." }, { status: 400 });
    }
    return NextResponse.json({ error: "Couldn't submit — please try again." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
