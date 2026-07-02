"use client";

import { memo, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const WD = ["S", "M", "T", "W", "T", "F", "S"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** A compact clickable month grid (Google-style date navigator). */
function MiniMonthImpl({
  selected,
  weekStart = 0,
  onPick,
}: {
  selected: Date;
  weekStart?: number;
  onPick: (d: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  useEffect(() => {
    setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selected]);

  const today = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const labels = Array.from({ length: 7 }, (_, i) => WD[(i + weekStart) % 7]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#13131a] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-medium text-[#f0f0f5]">
          {cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}
        </p>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {labels.map((l, i) => (
          <span key={i} className="py-1 text-[10px] font-medium text-white/30">
            {l}
          </span>
        ))}
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const isSel = sameDay(d, selected);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                "flex h-7 items-center justify-center rounded-md text-[12px] tabular-nums transition-colors",
                isSel
                  ? "bg-[#6366f1] font-semibold text-white"
                  : isToday
                    ? "bg-white/[0.08] font-semibold text-[#a5b4fc]"
                    : inMonth
                      ? "text-white/75 hover:bg-white/[0.06]"
                      : "text-white/25 hover:bg-white/[0.04]",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const MiniMonth = memo(MiniMonthImpl);
