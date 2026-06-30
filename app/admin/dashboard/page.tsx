import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { AdminBoard } from "@/components/admin/admin-board";
import { Topbar } from "@/components/topbar";
import { SectionCard } from "@/components/ui/card";
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

  if (me?.role !== "admin") {
    return (
      <div className="min-h-screen">
        <Topbar />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <SectionCard
            title="Admin access required"
            description="Your account isn't an admin yet."
            icon={ShieldAlert}
          >
            <p className="text-sm text-slate-600">
              Grant yourself the admin role by running this in the Supabase SQL editor,
              then reload this page:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[13px] leading-relaxed text-slate-100">
              {`update public.profiles\nset role = 'admin'\nwhere email = '${user.email ?? "you@example.com"}';`}
            </pre>
          </SectionCard>
        </main>
      </div>
    );
  }

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
    <div className="min-h-screen">
      <Topbar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Admin workspace</h1>
          <p className="text-[13px] text-slate-500">
            Triage and manage every interview request.
          </p>
        </div>
        <AdminBoard
          adminId={user.id}
          initialRequests={requests}
          initialCandidates={candidates}
        />
      </main>
    </div>
  );
}
