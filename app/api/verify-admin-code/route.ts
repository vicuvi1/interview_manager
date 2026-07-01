import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verifies the admin access code SERVER-SIDE (the code never reaches the browser).
 * Body: { code: string, mode?: "signin" | "signup" }.
 *
 *  - No mode / not authenticated → just validates the code: { valid }.
 *  - mode "signup" (authenticated)  → promotes the caller to role='admin'
 *    (service role, since RLS blocks clients from changing role): { valid, isAdmin }.
 *  - mode "signin" (authenticated)  → verifies the caller's existing role is
 *    'admin': { valid, isAdmin }.
 */
export async function POST(request: Request) {
  let code: unknown;
  let mode: unknown;
  try {
    ({ code, mode } = await request.json());
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const expected = process.env.ADMIN_ACCESS_CODE;
  const valid =
    typeof expected === "string" &&
    expected.length > 0 &&
    typeof code === "string" &&
    code === expected;

  if (!valid) return NextResponse.json({ valid: false });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ valid: true });

  if (mode === "signup") {
    const admin = createAdminClient();
    let isAdmin = false;
    if (admin) {
      const { error } = await admin
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", user.id);
      isAdmin = !error;
    }
    return NextResponse.json({ valid: true, isAdmin });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = (profile as { role?: string } | null)?.role === "admin";
  return NextResponse.json({ valid: true, isAdmin });
}
