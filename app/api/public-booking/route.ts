import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { name, email, role, preferred_at, timezone, notes, website, elapsedMs } = body ?? {};

  // Honeypot — a hidden field only a bot would fill. Pretend success, drop it.
  if (typeof website === "string" && website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }
  // Submitted implausibly fast (< 2.5s) → almost certainly a bot. Silently drop.
  if (typeof elapsedMs === "number" && elapsedMs >= 0 && elapsedMs < 2500) {
    return NextResponse.json({ ok: true });
  }

  // Server-side validation.
  if (!name || String(name).trim().length < 2) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(String(email ?? "").trim())) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  if (!role || String(role).trim().length < 2) {
    return NextResponse.json({ error: "Tell us the role or topic." }, { status: 400 });
  }

  // Hash the client IP for per-IP rate limiting (no raw IP stored).
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const ipHash = createHash("sha256").update(`${ip}|pbr`).digest("hex");

  const supabase = createClient();
  const { error } = await supabase.rpc("submit_public_booking", {
    p_name: String(name).slice(0, 100),
    p_email: String(email).slice(0, 200),
    p_role: String(role).slice(0, 120),
    p_preferred_at: preferred_at || null,
    p_timezone: timezone ? String(timezone).slice(0, 60) : null,
    p_notes: notes ? String(notes).slice(0, 2000) : null,
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
