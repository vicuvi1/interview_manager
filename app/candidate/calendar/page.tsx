import { redirect } from "next/navigation";

import { CandidateCalendar } from "@/components/calendar/candidate-calendar";
import { CandidateNav } from "@/components/candidate-nav";
import { Topbar } from "@/components/topbar";
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
    .order("scheduled_at", { ascending: true });
  const interviews = (data as InterviewRequest[] | null) ?? [];

  return (
    <div className="min-h-screen">
      <Topbar />
      <CandidateNav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <CandidateCalendar userId={user.id} timezone={timezone} initial={interviews} />
      </main>
    </div>
  );
}
