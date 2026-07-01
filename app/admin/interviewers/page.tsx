import { redirect } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock, Mail, ShieldCheck, UserCog } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/time";
import { initials } from "@/lib/utils";
import type { InterviewRequest, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminInterviewersPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profs }, { data: reqs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, timezone, role, created_at")
      .eq("role", "admin")
      .order("created_at", { ascending: true }),
    supabase.from("interview_requests").select("*").not("interviewer_id", "is", null),
  ]);
  const team = (profs as ProfileLite[] | null) ?? [];
  const requests = (reqs as InterviewRequest[] | null) ?? [];

  const now = Date.now();
  const statsFor = (id: string) => {
    let assigned = 0, upcoming = 0, completed = 0;
    for (const r of requests) {
      if (r.interviewer_id !== id) continue;
      assigned += 1;
      if (r.status === "scheduled" && r.scheduled_at && new Date(r.scheduled_at).getTime() >= now) upcoming += 1;
      if (r.status === "completed") completed += 1;
    }
    return { assigned, upcoming, completed };
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Interviewers</h1>
        <p className="text-[12px] text-white/40">Your admin team and their interview load.</p>
      </div>

      <SectionCard title="Team" description={`${team.length} interviewer${team.length === 1 ? "" : "s"}`} icon={UserCog} bodyClassName="p-0 sm:p-0">
        {team.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={UserCog} title="No interviewers yet" />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {team.map((m) => {
              const s = statsFor(m.id);
              return (
                <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[12px] font-semibold text-white">
                      {initials(m.full_name, m.email)}
                    </span>
                    <div className="min-w-0">
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
                  </div>

                  <div className="flex shrink-0 items-center gap-4 pl-[52px] sm:pl-0">
                    <Stat label="Assigned" value={s.assigned} icon={UserCog} tone="text-white/70" />
                    <Stat label="Upcoming" value={s.upcoming} icon={CalendarClock} tone="text-[#a5b4fc]" />
                    <Stat label="Completed" value={s.completed} icon={CheckCircle2} tone="text-[#34d399]" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <p className="mt-4 px-1 text-[12px] text-white/35">
        Assign an interviewer when scheduling a request (Requests → Schedule). New interviewers become admins by
        verifying the access code at sign-up.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof UserCog;
  tone: string;
}) {
  return (
    <div className="text-center">
      <p className={`flex items-center justify-center gap-1 text-[15px] font-semibold tabular-nums ${tone}`}>
        <Icon className="h-3.5 w-3.5 opacity-70" />
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-white/30">{label}</p>
    </div>
  );
}
