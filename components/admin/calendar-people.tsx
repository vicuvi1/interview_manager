"use client";

import { memo, useState } from "react";

import { ColorPicker } from "@/components/ui/color-picker";
import { EVENT_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";

export interface CalPerson {
  id: string;
  name: string;
  color: string | null;
}

/** Google-Calendar-style list: per-candidate show/hide checkbox + custom color. */
function CalendarPeopleImpl({
  people,
  hidden,
  onToggle,
  onColor,
  onShowAll,
  onHideAll,
}: {
  people: CalPerson[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onColor: (id: string, color: string | null) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (people.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#13131a] p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">People</p>
        <p className="text-[12px] text-white/30">No candidates with interviews yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#13131a] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">People</p>
        <div className="flex items-center gap-1 text-[11px] font-medium">
          <button type="button" onClick={onShowAll} className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/[0.06] hover:text-white/80">
            All
          </button>
          <span className="text-white/20">·</span>
          <button type="button" onClick={onHideAll} className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/[0.06] hover:text-white/80">
            None
          </button>
        </div>
      </div>
      <ul className="space-y-0.5">
        {people.map((p) => {
          const shown = !hidden.has(p.id);
          const swatch = p.color ?? EVENT_COLORS[0].value;
          return (
            <li key={p.id}>
              <div className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() => onToggle(p.id)}
                  style={{ accentColor: swatch }}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded"
                  aria-label={`Show ${p.name}`}
                />
                <button
                  type="button"
                  onClick={() => setOpenId((v) => (v === p.id ? null : p.id))}
                  className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/10"
                  style={{ backgroundColor: swatch }}
                  title="Set color"
                  aria-label={`Set color for ${p.name}`}
                />
                <span className={cn("min-w-0 flex-1 truncate text-[13px]", shown ? "text-white/80" : "text-white/35")}>
                  {p.name}
                </span>
              </div>
              {openId === p.id ? (
                <div className="px-1 py-1.5">
                  <ColorPicker
                    value={p.color}
                    onChange={(c) => {
                      onColor(p.id, c);
                      setOpenId(null);
                    }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const CalendarPeople = memo(CalendarPeopleImpl);
