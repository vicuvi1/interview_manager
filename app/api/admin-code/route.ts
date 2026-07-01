import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verifies the admin access code server-side (the code is never sent to the
 * browser). If the code is valid AND the caller is authenticated, promotes them
 * to the admin role using the service-role client.
 *
 * Returns { valid: boolean, promoted?: boolean }.
 */
export async function POST(request: Request) {
  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const expected = process.env.ADMIN_ACCESS_CODE;
  const valid =
    typeof expected === "string" &&
    expected.length > 0 &&
    typeof code === "string" &&
    code === expected;

  if (!valid) {
    return NextResponse.json({ valid: false });
  }

  // Promote the signed-in user to admin (if there is one). RLS forbids clients
  // from changing profiles.role, so this must go through the service role.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let promoted = false;
  if (user) {
    const admin = createAdminClient();
    if (admin) {
      const { error } = await admin
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", user.id);
      promoted = !error;
    }
  }

  return NextResponse.json({ valid: true, promoted });
}
