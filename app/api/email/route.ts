import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

const DEFAULT_FROM = "Interview Scheduler <onboarding@resend.dev>";

// Any signed-in user can send a test to THEIR OWN saved notification address.
// The Resend key lives in app_email_config (admin-only via RLS), so it is read
// with the service-role client — never returned to the browser.
async function handleTestForMe(): Promise<NextResponse> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profRow } = await supabase
    .from("profiles")
    .select("email, notify_email, notify_email_enabled")
    .eq("id", user.id)
    .maybeSingle();
  const prof = profRow as { email: string | null; notify_email: string | null; notify_email_enabled: boolean } | null;
  if (prof && prof.notify_email_enabled === false) {
    return NextResponse.json({ error: "Turn email notifications on and save first." }, { status: 400 });
  }
  const to = (prof?.notify_email?.trim() || prof?.email || user.email || "").trim();
  if (!to) return NextResponse.json({ error: "No email on file to send to." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Email delivery isn't set up yet." }, { status: 400 });
  const { data: cfgRow } = await admin
    .from("app_email_config")
    .select("resend_api_key, email_from, enabled")
    .eq("id", 1)
    .maybeSingle();
  const cfg = cfgRow as { resend_api_key: string | null; email_from: string | null; enabled: boolean } | null;
  if (!cfg?.enabled || !cfg?.resend_api_key) {
    return NextResponse.json({ error: "The admin hasn't enabled email delivery yet." }, { status: 400 });
  }

  const result = await sendEmail({
    apiKey: cfg.resend_api_key,
    from: cfg.email_from || DEFAULT_FROM,
    to,
    subject: "Test — Interview Scheduler email notifications",
    html: '<div style="font-family:sans-serif"><h2>It works ✅</h2><p>You\'ll get your interview updates at this address.</p></div>',
  });
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 400 });
  return NextResponse.json({ ok: true, to });
}

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
  const body = await request.json().catch(() => ({}));
  const action = body?.action as string;

  // "test-me" is available to any signed-in user (candidate self-test).
  if (action === "test-me") return handleTestForMe();

  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;
  const { supabase, email } = ctx;

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
