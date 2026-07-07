import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, CalendarRange, CheckCircle2, Clock, Mail, ShieldCheck, UserCog } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { initials } from "@/lib/utils";
import type { InterviewRequest, ProfileLite } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;

export default async function AdminInterviewersPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: meRow }, { data: profs }, { data: reqs }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email, timezone, role, created_at").order("created_at", { ascending: true }),
    supabase.from("interview_requests").select("*"),
  ]);
  const adminTz = (meRow as { timezone?: string } | null)?.timezone ?? "UTC";
  const allProfiles = (profs as ProfileLite[] | null) ?? [];
  const team = allProfiles.filter((p) => p.role === "admin");
  const requests = (reqs as InterviewRequest[] | null) ?? [];

  const nameOf = (id: string | null) => {
    if (!id) return "Candidate";
    const p = allProfiles.find((x) => x.id === id);
    return p ? p.full_name || p.email : "Candidate";
  };

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

  // "This week" = the next 7 days of scheduled interviews.
  const inWeek = (r: InterviewRequest) =>
    r.status === "scheduled" &&
    !!r.scheduled_at &&
    new Date(r.scheduled_at).getTime() >= now &&
    new Date(r.scheduled_at).getTime() <= now + WEEK_MS;
  const weekly = requests
    .filter(inWeek)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const weekFor = (id: string) => weekly.filter((r) => r.interviewer_id === id);
  const unassigned = weekly.filter((r) => !r.interviewer_id);

  const Row = ({ r }: { r: InterviewRequest }) => (
    <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">
      <span className="min-w-0 truncate text-white/75">
        <span className="text-white/50">{nameOf(r.candidate_id)}</span> · {r.role}
      </span>
      <span className="shrink-0 text-white/45">{formatInTimeZone(r.scheduled_at, adminTz)}</span>
    </li>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Interviewers</h1>
        <p className="text-[12px] text-white/40">Your admin team, their load, and who&apos;s doing what this week.</p>
      </div>

      {/* This week */}
      <SectionCard title="This week" description="Scheduled interviews over the next 7 days" icon={CalendarRange} bodyClassName="p-0 sm:p-0">
        {weekly.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={CalendarRange} title="Nothing scheduled this week" />
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {unassigned.length ? (
              <div className="px-4 py-3 sm:px-5">
                <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#fbbf24]">
                  <AlertTriangle className="h-3.5 w-3.5" /> Needs an interviewer ({unassigned.length})
                </p>
                <ul className="-mx-3">{unassigned.map((r) => <Row key={r.id} r={r} />)}</ul>
              </div>
            ) : null}
            {team.map((m) => {
              const rows = weekFor(m.id);
              return (
                <div key={m.id} className="px-4 py-3 sm:px-5">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[12.5px] font-medium text-[#f0f0f5]">{m.full_name || m.email}</p>
                    <span className="text-[11px] text-white/40">{rows.length} this week</span>
                  </div>
                  {rows.length ? (
                    <ul className="-mx-3">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
                  ) : (
                    <p className="px-0 py-1 text-[12px] text-white/30">No interviews this week.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Team totals */}
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
                        <span>joined {relativeTime(m.created_at, adminTz)}</span>
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

      <p className="px-1 text-[12px] text-white/35">
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
