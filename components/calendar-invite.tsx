"use client";

import { useState } from "react";
import { CalendarPlus, ChevronDown, Download } from "lucide-react";

import { downloadIcs, googleCalendarUrl } from "@/lib/calendar-invite";
import { cn } from "@/lib/utils";

/** "Add to calendar" — Google link + .ics download, for a scheduled interview. */
export function CalendarInvite({
  title,
  startISO,
  durationMin,
  location,
  details,
  className,
}: {
  title: string;
  startISO: string;
  durationMin: number;
  location?: string | null;
  details?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const invite = { title, startISO, durationMin, location, details };

  return (
    <div className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        title="Add to calendar"
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#13131a] py-1 shadow-xl">
          <a
            href={googleCalendarUrl(invite)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-white/75 hover:bg-white/[0.06]"
            onMouseDown={(e) => e.preventDefault()}
          >
            <CalendarPlus className="h-3.5 w-3.5 text-[#a5b4fc]" /> Google Calendar
          </a>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              downloadIcs(invite, `${title.replace(/[^\w]+/g, "-").slice(0, 40)}.ics`);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-white/75 hover:bg-white/[0.06]"
          >
            <Download className="h-3.5 w-3.5 text-[#a5b4fc]" /> Apple / Outlook (.ics)
          </button>
        </div>
      ) : null}
    </div>
  );
}
