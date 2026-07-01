import { redirect } from "next/navigation";

import { ProfileMaterialsForm } from "@/components/candidate/profile-materials-form";
import { SettingsForm } from "@/components/settings-form";
import { createClient } from "@/lib/supabase/server";
import type { CandidateMaterials, Profile } from "@/lib/types";

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
  const materials: CandidateMaterials = {
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
        <h1 className="text-xl font-medium text-[#f0f0f5]">Profile</h1>
        <p className="text-[12px] text-white/40">Manage your account details and materials.</p>
      </div>
      <div className="space-y-5">
        <SettingsForm
          userId={user.id}
          email={user.email ?? ""}
          initialName={profile?.full_name ?? ""}
          initialTimezone={profile?.timezone ?? "UTC"}
        />
        <ProfileMaterialsForm userId={user.id} initial={materials} />
      </div>
    </div>
  );
}
