import { redirect } from "next/navigation";

import { RevenueBoard } from "@/components/admin/revenue-board";
import { createClient } from "@/lib/supabase/server";
import type { Payment, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meRow } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const timezone = (meRow as { timezone?: string } | null)?.timezone ?? "UTC";

  const [{ data: pays }, { data: profs }] = await Promise.all([
    supabase.from("payments").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
  ]);

  return (
    <RevenueBoard
      adminTimezone={timezone}
      initialPayments={(pays as Payment[] | null) ?? []}
      initialProfiles={(profs as ProfileLite[] | null) ?? []}
    />
  );
}
