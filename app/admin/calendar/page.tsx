import { redirect } from "next/navigation";

import { AccessRequired } from "@/components/admin/access-required";
import { AdminCalendar } from "@/components/admin/admin-calendar";
import { AdminNav } from "@/components/admin/admin-nav";
import { Topbar } from "@/components/topbar";
import { isAdminUser } from "@/lib/auth";
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

  if (!isAdminUser(me, user.email)) {
    return <AccessRequired email={user.email ?? ""} />;
  }

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
    <div className="min-h-screen">
      <Topbar />
      <AdminNav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <AdminCalendar
          adminTimezone={me?.timezone ?? "UTC"}
          initialRequests={requests}
          initialCandidates={candidates}
        />
      </main>
    </div>
  );
}
