import { redirect } from "next/navigation";

import { AvailabilityShare } from "@/components/candidate/availability-share";
import { BookingModes } from "@/components/candidate/booking-modes";
import { createClient } from "@/lib/supabase/server";
import type { CandidateMaterials, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Book Interview" };

export default async function BookInterviewPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileRow as Profile | null;
  const timezone = profile?.timezone || "UTC";
  const materials: CandidateMaterials = {
    full_name: profile?.full_name ?? null,
    phone: profile?.phone ?? null,
    linkedin_url: profile?.linkedin_url ?? null,
    github_url: profile?.github_url ?? null,
    portfolio_url: profile?.portfolio_url ?? null,
    resume_url: profile?.resume_url ?? null,
    resume_path: profile?.resume_path ?? null,
    bio: profile?.bio ?? null,
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-medium text-[#f0f0f5]">Book an Interview</h1>
        <p className="mt-0.5 text-[13px] text-white/40">
          Pick an open time from the calendar, or send a detailed request.
        </p>
        <div className="mt-2.5 h-0.5 w-10 rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" />
      </div>
      <BookingModes userId={user.id} timezone={timezone} materials={materials} />
      <div className="mt-5 max-w-2xl">
        <AvailabilityShare userId={user.id} timezone={timezone} />
      </div>
    </div>
  );
}
