import { redirect } from "next/navigation";

import { SettingsForm } from "@/components/settings-form";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Profile" };

export default async function CandidateSettingsPage() {
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Profile</h1>
        <p className="text-[12px] text-white/40">Manage your account details.</p>
      </div>
      <SettingsForm
        userId={user.id}
        email={user.email ?? ""}
        initialName={profile?.full_name ?? ""}
        initialTimezone={profile?.timezone ?? "UTC"}
      />
    </div>
  );
}
