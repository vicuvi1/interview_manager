import { notFound, redirect } from "next/navigation";

import { CandidateDetail } from "@/components/admin/candidate-detail";
import { createClient } from "@/lib/supabase/server";
import type { CandidateNote, InterviewRequest, Payment, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({ params }: { params: { id: string } }) {
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

  const { data: candidateRow } = await supabase
    .from("profiles")
    .select("id, full_name, email, timezone, role, blocked, created_at")
    .eq("id", params.id)
    .maybeSingle();
  const candidate = candidateRow as ProfileLite | null;
  if (!candidate) notFound();

  const [{ data: reqs }, { data: pays }, { data: notes }] = await Promise.all([
    supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("*")
      .eq("candidate_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_notes")
      .select("*")
      .eq("candidate_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <CandidateDetail
      candidate={candidate}
      adminId={user.id}
      adminTimezone={timezone}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialPayments={(pays as Payment[] | null) ?? []}
      initialNotes={(notes as CandidateNote[] | null) ?? []}
    />
  );
}
