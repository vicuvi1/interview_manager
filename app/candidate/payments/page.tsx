import { redirect } from "next/navigation";

import { CandidatePayments } from "@/components/candidate/candidate-payments";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payments" };

export default async function CandidatePaymentsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const timezone = (profileRow as Profile | null)?.timezone || "UTC";

  const { data } = await supabase
    .from("interview_requests")
    .select("*")
    .eq("candidate_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Payments</h1>
        <p className="text-[12px] text-white/40">See what you owe and pay by crypto — choose your wallet at checkout.</p>
      </div>
      <CandidatePayments
        userId={user.id}
        timezone={timezone}
        initial={(data as InterviewRequest[] | null) ?? []}
      />
    </div>
  );
}
