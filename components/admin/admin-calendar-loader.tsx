"use client";

import dynamic from "next/dynamic";

import type { AvailabilitySlot, InterviewRequest, ProfileLite } from "@/lib/types";

// Defer the heavy FullCalendar bundle: the page shell paints first, then the
// calendar streams in with a skeleton placeholder.
const AdminCalendarBoard = dynamic(
  () => import("@/components/admin/admin-calendar-board").then((m) => m.AdminCalendarBoard),
  {
    ssr: false,
    loading: () => <div className="h-[660px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />,
  },
);

export function AdminCalendarLoader(props: {
  adminId: string;
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialSlots: AvailabilitySlot[];
  initialProfiles: ProfileLite[];
}) {
  return <AdminCalendarBoard {...props} />;
}
