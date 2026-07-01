import { redirect } from "next/navigation";

import { MyInterviewsCard } from "@/components/my-interviews-card";
import { NotificationsCard } from "@/components/notifications-card";
import { RequestInterviewCard } from "@/components/request-interview-card";
import { WelcomeHeader } from "@/components/welcome-header";
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
  const email = user.email ?? "";

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

  const interviews = (interviewsResult.data as InterviewRequest[] | null) ?? [];
  const notifications = (notificationsResult.data as Notification[] | null) ?? [];

  return (
    <div>
      <WelcomeHeader name={name} email={email} timezone={timezone} />

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <RequestInterviewCard userId={user.id} timezone={timezone} />
        <NotificationsCard userId={user.id} initial={notifications} />
      </div>

      <div className="mt-5">
        <MyInterviewsCard userId={user.id} timezone={timezone} initial={interviews} />
      </div>
    </div>
  );
}
