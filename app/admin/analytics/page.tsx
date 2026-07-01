import { redirect } from "next/navigation";

import { AnalyticsBoard } from "@/components/admin/analytics-board";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
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

  const [{ data: reqs }, { data: pays }] = await Promise.all([
    supabase.from("interview_requests").select("*"),
    supabase.from("payments").select("*"),
  ]);

  return (
    <AnalyticsBoard
      adminTimezone={timezone}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialPayments={(pays as Payment[] | null) ?? []}
    />
  );
}
