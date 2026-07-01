"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarRange, ExternalLink } from "lucide-react";

import { Calendar, type CalendarEvent } from "@/components/calendar/calendar";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, timeInTimeZone } from "@/lib/calendar";
import { formatInTimeZone } from "@/lib/time";
import type { InterviewRequest } from "@/lib/types";

export function CandidateCalendar({
  userId,
  timezone,
  initial,
}: {
  userId: string;
  timezone: string;
  initial: InterviewRequest[];
}) {
  const [rows, setRows] = useState<InterviewRequest[]>(initial);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", userId)
      .order("scheduled_at", { ascending: true });
    if (data) setRows(data as InterviewRequest[]);
  }, [userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`calendar-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "interview_requests",
          filter: `candidate_id=eq.${userId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  useDataChanged("interviews", load);

  const scheduled = useMemo(
    () => rows.filter((r) => r.scheduled_at && r.status === "scheduled"),
    [rows],
  );

  const events: CalendarEvent[] = useMemo(
    () =>
      scheduled.map((r) => ({
        id: r.id,
        dateKey: dateKeyInTimeZone(r.scheduled_at as string, timezone),
        time: timeInTimeZone(r.scheduled_at as string, timezone),
        label: r.role,
        link: r.meeting_link,
      })),
    [scheduled, timezone],
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
          description={`Times shown in ${timezone}.`}
          icon={CalendarDays}
        >
          <Calendar events={events} timezone={timezone} />
        </SectionCard>
      </div>

      <div className="lg:col-span-2">
        <SectionCard
          title="Upcoming"
          description="Your next confirmed interviews."
          icon={CalendarRange}
          bodyClassName="p-0 sm:p-0"
        >
          {upcoming.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={CalendarDays}
                title="Nothing scheduled"
                description="Approved requests appear here once a time is set."
              />
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {upcoming.map((r) => (
                <li key={r.id} className="px-5 py-3.5 sm:px-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[#f0f0f5]">{r.role}</p>
                    {r.meeting_link ? (
                      <a
                        href={r.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                      >
                        Join <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13px] text-white/55">
                    {formatInTimeZone(r.scheduled_at, timezone)} · {r.duration_minutes} min
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
