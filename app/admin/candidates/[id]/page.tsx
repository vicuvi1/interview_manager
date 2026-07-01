import { notFound, redirect } from "next/navigation";

import { CandidateDetail } from "@/components/admin/candidate-detail";
import { createClient } from "@/lib/supabase/server";
import type { CandidateMaterials, CandidateNote, InterviewRequest, Payment, Profile, ProfileLite } from "@/lib/types";

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
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  const full = candidateRow as Profile | null;
  if (!full) notFound();
  const candidate = full as ProfileLite;
  const materials: CandidateMaterials = {
    phone: full.phone ?? null,
    linkedin_url: full.linkedin_url ?? null,
    github_url: full.github_url ?? null,
    portfolio_url: full.portfolio_url ?? null,
    resume_url: full.resume_url ?? null,
    resume_path: full.resume_path ?? null,
    bio: full.bio ?? null,
  };
  if (full.resume_path) {
    const { data: signed } = await supabase.storage.from("resumes").createSignedUrl(full.resume_path, 3600);
    materials.resume_signed_url = signed?.signedUrl ?? null;
  }

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
      materials={materials}
      adminId={user.id}
      adminTimezone={timezone}
      initialRequests={(reqs as InterviewRequest[] | null) ?? []}
      initialPayments={(pays as Payment[] | null) ?? []}
      initialNotes={(notes as CandidateNote[] | null) ?? []}
    />
  );
}
