import { redirect } from "next/navigation";

import { MyInterviewsCard } from "@/components/my-interviews-card";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "My Interviews" };

export default async function CandidateInterviewsPage() {
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">My interviews</h1>
        <p className="text-[12px] text-white/40">Every request you&apos;ve made and its status.</p>
      </div>
      <MyInterviewsCard
        userId={user.id}
        timezone={timezone}
        initial={(data as InterviewRequest[] | null) ?? []}
      />
    </div>
  );
}
