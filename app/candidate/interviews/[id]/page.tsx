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

  // Activity trail (RLS lets candidates read their own interview's audit rows,
  // migration 0072). Empty until that migration is applied — degrades gracefully.
  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("id, summary, created_at")
    .eq("entity_type", "interview")
    .eq("entity_id", params.id)
    .order("created_at", { ascending: true });

  return (
    <CandidateInterviewView
      interview={interview}
      timezone={timezone}
      activity={(auditRows as { id: string; summary: string; created_at: string }[] | null) ?? []}
    />
  );
}
