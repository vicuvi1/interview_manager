import { redirect } from "next/navigation";

import { AdminCalendarLoader } from "@/components/admin/admin-calendar-loader";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilitySlot, InterviewRequest, Profile, ProfileLite } from "@/lib/types";

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

  const [requestsResult, slotsResult, profilesResult] = await Promise.all([
    supabase.from("interview_requests").select("*"),
    supabase.from("availability_slots").select("*"),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at, calendar_color"),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Calendar</h1>
          <p className="text-[12px] text-white/40">
            Interviews, availability, and blocked time — drag a scheduled interview to reschedule.
          </p>
        </div>
      </div>
      <AdminCalendarLoader
        adminId={user.id}
        adminTimezone={me?.timezone ?? "UTC"}
        initialRequests={(requestsResult.data as InterviewRequest[] | null) ?? []}
        initialSlots={(slotsResult.data as AvailabilitySlot[] | null) ?? []}
        initialProfiles={(profilesResult.data as ProfileLite[] | null) ?? []}
      />
    </div>
  );
}
