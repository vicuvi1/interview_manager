import { redirect } from "next/navigation";

import { RequestsConsole } from "@/components/admin/requests-console";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilitySlot, InterviewRequest, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
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

  const [{ data: reqs }, { data: profs }, { data: slots }] = await Promise.all([
    supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
    supabase.from("availability_slots").select("*"),
  ]);

  return (
    <RequestsConsole
      adminTimezone={timezone}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialProfiles={(profs as ProfileLite[] | null) ?? []}
      initialSlots={(slots as AvailabilitySlot[] | null) ?? []}
    />
  );
}
