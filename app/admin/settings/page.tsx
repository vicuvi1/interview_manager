import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

import { SettingsForm } from "@/components/settings-form";
import { EmailCard } from "@/components/admin/email-card";
import { TelegramCard } from "@/components/admin/telegram-card";
import { TemplatesCard } from "@/components/admin/templates-card";
import { SectionCard } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
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
        <h1 className="text-xl font-medium text-[#f0f0f5]">Settings</h1>
        <p className="text-[12px] text-white/40">Your admin profile and workspace access.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <SettingsForm
            userId={user.id}
            email={user.email ?? ""}
            initialName={profile?.full_name ?? ""}
            initialTimezone={profile?.timezone ?? "UTC"}
          />
          <TemplatesCard />
          <TelegramCard />
          <EmailCard />
        </div>

        <SectionCard title="Admin access" description="How this workspace is secured." icon={ShieldCheck}>
          <ul className="space-y-3 text-[13px]">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
              <span className="text-white/70">
                You&apos;re signed in as an <span className="font-medium text-[#f0f0f5]">admin</span> — full access to
                requests, candidates, payments, and controls.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#a5b4fc]" />
              <span className="text-white/70">
                New admins are promoted with a one-time <span className="font-medium text-[#f0f0f5]">access code</span>,
                verified on the server only — it&apos;s never exposed to the browser.
              </span>
            </li>
          </ul>
          <p className="mt-4 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/45">
            Sign out any time from the account menu at the bottom of the sidebar.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
