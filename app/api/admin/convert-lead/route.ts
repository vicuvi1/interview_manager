import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length];
  return out;
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!isAdminUser(profileRow as Profile | null, user.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Set SUPABASE_SERVICE_ROLE_KEY to convert leads into accounts." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const leadId = String(body?.leadId ?? "");
  if (!leadId) return NextResponse.json({ error: "Missing lead." }, { status: 400 });

  const { data: leadRow } = await admin.from("public_booking_requests").select("*").eq("id", leadId).maybeSingle();
  const lead = leadRow as
    | { id: string; name: string; email: string; role: string; preferred_at: string | null; timezone: string | null; notes: string | null; status: string }
    | null;
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const email = lead.email.trim().toLowerCase();

  // Find an existing profile with this email, else create an account.
  let candidateId: string | null = null;
  let createdPassword: string | null = null;

  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    candidateId = (existing as { id: string }).id;
  } else {
    const password = genPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: lead.name, timezone: lead.timezone ?? "UTC" },
    });
    if (createError || !created?.user) {
      return NextResponse.json({ error: createError?.message ?? "Couldn't create the account." }, { status: 500 });
    }
    candidateId = created.user.id;
    createdPassword = password;
  }

  // Create the interview request for this candidate.
  const { error: reqError } = await admin.from("interview_requests").insert({
    candidate_id: candidateId,
    role: lead.role,
    preferred_at: lead.preferred_at,
    duration_minutes: 30,
    notes: lead.notes,
    status: "pending",
  });
  if (reqError) return NextResponse.json({ error: reqError.message }, { status: 500 });

  await admin.from("public_booking_requests").update({ status: "converted" }).eq("id", leadId);

  return NextResponse.json({ ok: true, email, password: createdPassword });
}
