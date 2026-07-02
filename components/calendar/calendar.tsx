"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

import {
  buildMonth,
  formatDateKey,
  MONTH_NAMES,
  todayKeyInTimeZone,
  WEEKDAYS,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  dateKey: string;
  time: string;
  label: string;
  link?: string | null;
  color?: string | null;
}

export function Calendar({
  events,
  timezone,
}: {
  events: CalendarEvent[];
  timezone: string;
}) {
  const todayKey = todayKeyInTimeZone(timezone);
  const [year, mon] = todayKey.split("-").map(Number);
  const [view, setView] = useState<{ y: number; m: number }>({ y: year, m: mon - 1 });
  const [selected, setSelected] = useState<string>(todayKey);

  const cells = useMemo(() => buildMonth(view.y, view.m), [view]);
  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of events) (map[e.dateKey] ??= []).push(e);
    return map;
  }, [events]);

  const selectedEvents = byDay[selected] ?? [];

  function shift(delta: number) {
    setView((prev) => {
      const m = prev.m + delta;
      const y = prev.y + Math.floor(m / 12);
      return { y, m: ((m % 12) + 12) % 12 };
    });
  }

  function goToday() {
    const [ty, tm] = todayKey.split("-").map(Number);
    setView({ y: ty, m: tm - 1 });
    setSelected(todayKey);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-medium text-[#f0f0f5]">
          {MONTH_NAMES[view.m]} {view.y}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06]"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-md px-2 py-1 text-[13px] font-medium text-white/60 transition-colors hover:bg-white/[0.06]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06]"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-white/40"
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const evs = byDay[c.key] ?? [];
          const isToday = c.key === todayKey;
          const isSelected = c.key === selected;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(c.key)}
              className={cn(
                "flex aspect-square flex-col items-center justify-start rounded-lg p-1 transition-colors",
                c.inMonth ? "text-white/80" : "text-white/25",
                isSelected ? "bg-[#6366f1]/10 ring-1 ring-[#6366f1]" : "hover:bg-white/[0.06]",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[12px]",
                  isToday ? "bg-[#6366f1] font-semibold text-white" : "",
                )}
              >
                {c.day}
              </span>
              {evs.length ? (
                <span className="mt-0.5 flex gap-0.5">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.color ?? "#6366f1" }} />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <p className="mb-2 text-[13px] font-medium text-white/80">{formatDateKey(selected)}</p>
        {selectedEvents.length === 0 ? (
          <p className="text-[13px] text-white/40">No interviews scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "#6366f1" }} />
                <span className="text-[13px] font-medium tabular-nums text-white/80">
                  {e.time}
                </span>
                <span className="flex-1 truncate text-sm text-white/80">{e.label}</span>
                {e.link ? (
                  <a
                    href={e.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                  >
                    Join <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
