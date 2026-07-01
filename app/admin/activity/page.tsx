import { redirect } from "next/navigation";

import { ActivityLog } from "@/components/admin/activity-log";
import { createClient } from "@/lib/supabase/server";
import type { AuditLog, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: logs }, { data: profs }] = await Promise.all([
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
  ]);

  const actors: Record<string, string> = {};
  for (const p of (profs as ProfileLite[] | null) ?? []) {
    actors[p.id] = p.full_name || p.email || "Someone";
  }

  return <ActivityLog initial={(logs as AuditLog[] | null) ?? []} actors={actors} />;
}
