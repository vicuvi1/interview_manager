import { redirect } from "next/navigation";

import { PaymentsBoard } from "@/components/admin/payments-board";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
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

  const [{ data: reqs }, { data: profs }] = await Promise.all([
    supabase
      .from("interview_requests")
      .select("*")
      .not("price_cents", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
  ]);

  return (
    <PaymentsBoard
      adminTimezone={timezone}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialProfiles={(profs as ProfileLite[] | null) ?? []}
    />
  );
}
