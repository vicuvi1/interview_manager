import { redirect } from "next/navigation";

import { InterviewsBoard } from "@/components/admin/interviews-board";
import { createClient } from "@/lib/supabase/server";
import type { InterviewRequest, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminInterviewsPage() {
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

  const [{ data: reqs }, { data: profs }] = await Promise.all([
    supabase.from("interview_requests").select("*").order("scheduled_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Interviews</h1>
        <p className="text-[12px] text-white/40">
          Every candidate&apos;s interviews — upcoming and past. Send the meeting link &amp; time, review the
          meeting minutes, and see what&apos;s paid.
        </p>
      </div>
      <InterviewsBoard
        adminTimezone={timezone}
        initialRequests={(reqs as InterviewRequest[] | null) ?? []}
        initialProfiles={(profs as ProfileLite[] | null) ?? []}
      />
    </div>
  );
}
