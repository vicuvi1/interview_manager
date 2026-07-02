"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";

import { type CalendarPrefs, DEFAULT_PREFS } from "@/lib/calendar-prefs";
import { cn } from "@/lib/utils";

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  const am = h < 12;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${am ? "AM" : "PM"}`;
}

/** A gear button + popover to tune personal calendar display prefs. */
export function CalendarSettings({
  value,
  onChange,
}: {
  value: CalendarPrefs;
  onChange: (next: CalendarPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<CalendarPrefs>) => onChange({ ...value, ...patch });

  // Close when clicking outside (reliable — unlike blur, it never blocks the
  // native <select> dropdowns from opening).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#13131a] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/90",
          open && "bg-white/[0.06] text-white/90",
        )}
        title="Calendar settings"
        aria-label="Calendar settings"
      >
        <Settings2 className="h-[18px] w-[18px]" />
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#161620] p-4 shadow-2xl shadow-black/50">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-white/45">Calendar settings</p>

          <div className="space-y-3">
            <Row label="Time format">
              <Toggle
                options={[
                  { v: true, l: "12h" },
                  { v: false, l: "24h" },
                ]}
                value={value.hour12}
                onPick={(v) => set({ hour12: v })}
              />
            </Row>

            <Row label="Week starts">
              <Toggle
                options={[
                  { v: 0, l: "Sun" },
                  { v: 1, l: "Mon" },
                ]}
                value={value.weekStart}
                onPick={(v) => set({ weekStart: v })}
              />
            </Row>

            <Row label="Day starts">
              <HourSelect value={value.dayStart} min={0} max={value.dayEnd - 1} onPick={(h) => set({ dayStart: h })} />
            </Row>

            <Row label="Day ends">
              <HourSelect value={value.dayEnd} min={value.dayStart + 1} max={24} onPick={(h) => set({ dayEnd: h })} />
            </Row>
          </div>

          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_PREFS, timeZone: value.timeZone, hiddenStatuses: value.hiddenStatuses })}
            className="mt-4 w-full rounded-xl border border-white/10 py-2 text-[13px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/85"
          >
            Reset to defaults
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px] text-white/80">{label}</span>
      {children}
    </div>
  );
}

function Toggle<T extends string | number | boolean>({
  options,
  value,
  onPick,
}: {
  options: { v: T; l: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-white/12 bg-[#0f0f16] p-1">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onPick(o.v)}
          className={cn(
            "rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
            value === o.v ? "bg-[#6366f1] text-white shadow" : "text-white/50 hover:text-white/85",
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function HourSelect({
  value,
  min,
  max,
  onPick,
}: {
  value: number;
  min: number;
  max: number;
  onPick: (h: number) => void;
}) {
  const hours: number[] = [];
  for (let h = min; h <= max; h++) hours.push(h);
  return (
    <select
      value={value}
      onChange={(e) => onPick(Number(e.target.value))}
      className="h-10 rounded-xl border border-white/12 bg-[#0f0f16] px-3 text-[13px] font-medium text-white/90 focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30"
    >
      {hours.map((h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </select>
  );
}
