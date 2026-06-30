"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarRange, ExternalLink } from "lucide-react";

import { Calendar, type CalendarEvent } from "@/components/calendar/calendar";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, timeInTimeZone } from "@/lib/calendar";
import { formatInTimeZone } from "@/lib/time";
import type { CandidateLite, InterviewRequest } from "@/lib/types";

export function AdminCalendar({
  adminTimezone,
  initialRequests,
  initialCandidates,
}: {
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialCandidates: Record<string, CandidateLite>;
}) {
  const [rows, setRows] = useState<InterviewRequest[]>(initialRequests);
  const [candidates, setCandidates] = useState<Record<string, CandidateLite>>(initialCandidates);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase
        .from("interview_requests")
        .select("*")
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true }),
      supabase.from("profiles").select("id, full_name, email, timezone"),
    ]);
    if (reqs) setRows(reqs as InterviewRequest[]);
    if (profs) {
      const map: Record<string, CandidateLite> = {};
      for (const p of profs as (CandidateLite & { id: string })[]) {
        map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
      }
      setCandidates(map);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-calendar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interview_requests" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const scheduled = useMemo(
    () => rows.filter((r) => r.scheduled_at && r.status === "scheduled"),
    [rows],
  );

  const events: CalendarEvent[] = useMemo(
    () =>
      scheduled.map((r) => ({
        id: r.id,
        dateKey: dateKeyInTimeZone(r.scheduled_at as string, adminTimezone),
        time: timeInTimeZone(r.scheduled_at as string, adminTimezone),
        label: `${candidates[r.candidate_id]?.full_name || "Candidate"} · ${r.role}`,
        link: r.meeting_link,
      })),
    [scheduled, candidates, adminTimezone],
  );

  const upcoming = useMemo(() => {
    const now = Date.now();
    return scheduled
      .filter((r) => new Date(r.scheduled_at as string).getTime() >= now)
      .slice(0, 6);
  }, [scheduled]);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <SectionCard
          title="Schedule"
          description={`All scheduled interviews · times in ${adminTimezone}.`}
          icon={CalendarDays}
        >
          <Calendar events={events} timezone={adminTimezone} />
        </SectionCard>
      </div>

      <div className="lg:col-span-2">
        <SectionCard
          title="Upcoming"
          description="Your next confirmed calls."
          icon={CalendarRange}
          bodyClassName="p-0 sm:p-0"
        >
          {upcoming.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={CalendarDays}
                title="Nothing scheduled"
                description="Schedule an approved request to populate the calendar."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((r) => (
                <li key={r.id} className="px-5 py-3.5 sm:px-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {candidates[r.candidate_id]?.full_name || "Candidate"}
                    </p>
                    {r.meeting_link ? (
                      <a
                        href={r.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700"
                      >
                        Join <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    {r.role} · {formatInTimeZone(r.scheduled_at, adminTimezone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
