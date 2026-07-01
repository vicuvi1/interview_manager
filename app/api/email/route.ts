import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!isAdminUser(profileRow as Profile | null, user.email)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { supabase, email: user.email ?? "" };
}

export async function GET() {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  const { data } = await ctx.supabase
    .from("app_email_config")
    .select("email_from, enabled, resend_api_key")
    .eq("id", 1)
    .maybeSingle();
  const row = data as { email_from: string | null; enabled: boolean; resend_api_key: string | null } | null;

  return NextResponse.json({
    enabled: row?.enabled ?? false,
    emailFrom: row?.email_from ?? "Interview Scheduler <onboarding@resend.dev>",
    hasKey: !!row?.resend_api_key,
  });
}

export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase, email } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = body?.action as string;

  if (action === "save") {
    const update: Record<string, unknown> = {
      email_from: String(body?.emailFrom ?? "").trim() || "Interview Scheduler <onboarding@resend.dev>",
      enabled: body?.enabled !== false,
      updated_at: new Date().toISOString(),
    };
    const key = String(body?.apiKey ?? "").trim();
    if (key) update.resend_api_key = key; // only overwrite when a new key is provided
    const { error } = await supabase.from("app_email_config").update(update).eq("id", 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "test") {
    const { data } = await supabase
      .from("app_email_config")
      .select("resend_api_key, email_from")
      .eq("id", 1)
      .maybeSingle();
    const cfg = data as { resend_api_key: string | null; email_from: string | null } | null;
    if (!cfg?.resend_api_key) return NextResponse.json({ error: "Add your Resend API key and save first." }, { status: 400 });
    if (!email) return NextResponse.json({ error: "Your account has no email." }, { status: 400 });

    const result = await sendEmail({
      apiKey: cfg.resend_api_key,
      from: cfg.email_from || "Interview Scheduler <onboarding@resend.dev>",
      to: email,
      subject: "Test email from Interview Scheduler",
      html: '<div style="font-family:sans-serif"><h2>It works ✅</h2><p>Email notifications are configured correctly.</p></div>',
    });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
    return NextResponse.json({ ok: true, to: email });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
