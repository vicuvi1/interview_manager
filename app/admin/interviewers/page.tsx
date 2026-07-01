import { redirect } from "next/navigation";
import { Clock, Mail, ShieldCheck, UserCog } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/time";
import { initials } from "@/lib/utils";
import type { ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminInterviewersPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, timezone, role, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });
  const team = (data as ProfileLite[] | null) ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Interviewers</h1>
        <p className="text-[12px] text-white/40">Your admin team — everyone who can run interviews.</p>
      </div>

      <SectionCard title="Team" description={`${team.length} interviewer${team.length === 1 ? "" : "s"}`} icon={UserCog} bodyClassName="p-0 sm:p-0">
        {team.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={UserCog} title="No interviewers yet" />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[12px] font-semibold text-white">
                  {initials(m.full_name, m.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{m.full_name || m.email}</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#8b5cf6]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#c4b5fd]">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-white/45">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {m.email}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {m.timezone}
                    </span>
                    <span>joined {relativeTime(m.created_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="mt-4 px-1 text-[12px] text-white/35">
        New interviewers become admins by verifying the access code at sign-up. Candidates are managed under Candidates.
      </p>
    </div>
  );
}
