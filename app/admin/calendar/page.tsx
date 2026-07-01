import { redirect } from "next/navigation";

import { AdminCalendar } from "@/components/admin/admin-calendar";
import { createClient } from "@/lib/supabase/server";
import type { CandidateLite, InterviewRequest, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage() {
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
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true }),
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
        <h1 className="text-xl font-medium text-[#f0f0f5]">Calendar</h1>
        <p className="text-[12px] text-white/40">All scheduled interviews.</p>
      </div>
      <AdminCalendar
        adminTimezone={me?.timezone ?? "UTC"}
        initialRequests={requests}
        initialCandidates={candidates}
      />
    </div>
  );
}
