import { redirect } from "next/navigation";

import { AdminBoard } from "@/components/admin/admin-board";
import { createClient } from "@/lib/supabase/server";
import type { CandidateLite, InterviewRequest, Profile } from "@/lib/types";

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
    supabase
      .from("interview_requests")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone"),
  ]);

  const requests = (requestsResult.data as InterviewRequest[] | null) ?? [];
  const candidates: Record<string, CandidateLite> = {};
  for (const p of (profilesResult.data as (CandidateLite & { id: string })[] | null) ?? []) {
    candidates[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Admin workspace</h1>
        <p className="text-[12px] text-white/40">
          Triage requests, schedule calls, invoice, and track revenue.
        </p>
      </div>
      <AdminBoard
        adminId={user.id}
        adminTimezone={me?.timezone ?? "UTC"}
        initialRequests={requests}
        initialCandidates={candidates}
      />
    </div>
  );
}
