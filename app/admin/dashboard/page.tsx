import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { OnboardingChecklist } from "@/components/admin/onboarding-checklist";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Profile, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const me = meRow as Profile | null;

  const [requestsResult, profilesResult] = await Promise.all([
    supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at, calendar_color"),
  ]);

  const requests = (requestsResult.data as InterviewRequest[] | null) ?? [];
  const profiles = (profilesResult.data as ProfileLite[] | null) ?? [];

  return (
    <>
      <OnboardingChecklist />
      <AdminDashboard
        adminTimezone={me?.timezone ?? "UTC"}
        initialRequests={requests}
        initialProfiles={profiles}
      />
    </>
  );
}
