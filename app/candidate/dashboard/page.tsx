import { redirect } from "next/navigation";

import { CandidateDashboard } from "@/components/candidate/candidate-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Notification, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidateDashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileRow as Profile | null;

  const timezone = profile?.timezone || "UTC";
  const name = profile?.full_name || (user.user_metadata?.full_name as string) || "";

  const [interviewsResult, notificationsResult] = await Promise.all([
    supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <CandidateDashboard
      userId={user.id}
      name={name}
      timezone={timezone}
      stage={profile?.stage ?? null}
      initialInterviews={(interviewsResult.data as InterviewRequest[] | null) ?? []}
      initialNotifications={(notificationsResult.data as Notification[] | null) ?? []}
    />
  );
}
