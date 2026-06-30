import { redirect } from "next/navigation";

import { CandidateNav } from "@/components/candidate-nav";
import { SettingsForm } from "@/components/settings-form";
import { Topbar } from "@/components/topbar";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

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
    <div className="min-h-screen">
      <Topbar />
      <CandidateNav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <SettingsForm
          userId={user.id}
          email={user.email ?? ""}
          initialName={profile?.full_name ?? ""}
          initialTimezone={profile?.timezone ?? "UTC"}
        />
      </main>
    </div>
  );
}
