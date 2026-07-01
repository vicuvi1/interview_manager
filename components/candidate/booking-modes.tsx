"use client";

import { useState } from "react";
import { CalendarClock, FileText } from "lucide-react";

import { BookingCalendar } from "@/components/candidate/booking-calendar";
import { InterviewRequestForm } from "@/components/candidate/interview-request-form";
import { cn } from "@/lib/utils";
import type { CandidateMaterials } from "@/lib/types";

export function BookingModes({
  userId,
  timezone,
  materials,
}: {
  userId: string;
  timezone: string;
  materials: CandidateMaterials;
}) {
  const [mode, setMode] = useState<"calendar" | "form">("calendar");

  const tabs = [
    { v: "calendar" as const, l: "Pick a time", icon: CalendarClock },
    { v: "form" as const, l: "Request in detail", icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-white/[0.06] bg-[#0f0f13] p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              type="button"
              onClick={() => setMode(t.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                mode === t.v ? "bg-[#1a1a24] text-[#f0f0f5]" : "text-white/40 hover:text-white/70",
              )}
            >
              <Icon className="h-4 w-4" /> {t.l}
            </button>
          );
        })}
      </div>

      {mode === "calendar" ? (
        <BookingCalendar timezone={timezone} />
      ) : (
        <div className="max-w-2xl">
          <InterviewRequestForm userId={userId} timezone={timezone} materials={materials} />
        </div>
      )}
    </div>
  );
}
