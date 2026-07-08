import { NextResponse } from "next/server";

import { isAdminUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign a file in the private "resumes" bucket for an admin. Client-side signing
 * fails when storage RLS only lets the file's owner read it, so admins couldn't
 * open a candidate's résumé / job description. Signing here with the service-role
 * client bypasses RLS; we fall back to the admin's own session if the service
 * key isn't configured.
 */
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

  const body = await request.json().catch(() => ({}));
  const path = String(body?.path ?? "");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const signer = createAdminClient() ?? supabase;
  const { data, error } = await signer.storage.from("resumes").createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? "Could not sign file" }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
