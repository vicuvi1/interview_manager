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
      { error: "Set SUPABASE_SERVICE_ROLE_KEY in your environment to manage user accounts." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action as string;
  const targetId = String(body?.userId ?? "");
  if (!targetId) return NextResponse.json({ error: "Missing user." }, { status: 400 });
  if (targetId === user.id) {
    return NextResponse.json({ error: "You can't do this to your own account." }, { status: 400 });
  }

  if (action === "reset-password") {
    const password = genPassword();
    const { error } = await admin.auth.admin.updateUserById(targetId, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: p } = await admin.from("profiles").select("email").eq("id", targetId).maybeSingle();
    return NextResponse.json({ ok: true, password, email: (p as { email?: string } | null)?.email ?? null });
  }

  if (action === "delete") {
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
