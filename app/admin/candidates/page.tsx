import { redirect } from "next/navigation";

import { CandidatesList } from "@/components/admin/candidates-list";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Payment, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
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

  const [{ data: profs }, { data: reqs }, { data: pays }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, timezone, role, blocked, tags, created_at"),
    supabase.from("interview_requests").select("*"),
    supabase.from("payments").select("*"),
  ]);

  return (
    <CandidatesList
      adminTimezone={timezone}
      initialProfiles={(profs as ProfileLite[] | null) ?? []}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialPayments={(pays as Payment[] | null) ?? []}
    />
  );
}
