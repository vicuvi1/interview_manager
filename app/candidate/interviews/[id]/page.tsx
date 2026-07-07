import { notFound, redirect } from "next/navigation";

import { CandidateInterviewView } from "@/components/candidate/interview-view";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidateInterviewPage({ params }: { params: { id: string } }) {
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

  // RLS restricts this to the candidate's own rows; double-check ownership.
  const { data } = await supabase.from("interview_requests").select("*").eq("id", params.id).maybeSingle();
  const interview = data as InterviewRequest | null;
  if (!interview || interview.candidate_id !== user.id) notFound();

  return <CandidateInterviewView interview={interview} timezone={timezone} />;
}
