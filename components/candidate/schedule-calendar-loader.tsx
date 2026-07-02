"use client";

import dynamic from "next/dynamic";

import type { InterviewRequest } from "@/lib/types";

// Defer the heavy FullCalendar bundle: the page shell paints first.
const ScheduleCalendar = dynamic(
  () => import("@/components/candidate/schedule-calendar").then((m) => m.ScheduleCalendar),
  {
    ssr: false,
    loading: () => <div className="h-[640px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />,
  },
);

export function ScheduleCalendarLoader(props: { userId: string; timezone: string; initial: InterviewRequest[] }) {
  return <ScheduleCalendar {...props} />;
}
