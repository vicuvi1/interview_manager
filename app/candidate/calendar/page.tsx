import { redirect } from "next/navigation";

import { ScheduleCalendarLoader } from "@/components/candidate/schedule-calendar-loader";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidateCalendarPage() {
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
  const timezone = (profileRow as Profile | null)?.timezone || "UTC";

  const { data } = await supabase
    .from("interview_requests")
    .select("*")
    .eq("candidate_id", user.id)
    .order("created_at", { ascending: false });
  const interviews = (data as InterviewRequest[] | null) ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Calendar</h1>
        <p className="text-[12px] text-white/40">All your interviews — pending, scheduled, and past.</p>
      </div>
      <ScheduleCalendarLoader userId={user.id} timezone={timezone} initial={interviews} />
    </div>
  );
}
