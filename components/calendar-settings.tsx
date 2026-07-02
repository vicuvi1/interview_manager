"use client";

import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";

import { type CalendarPrefs, timezoneList } from "@/lib/calendar-prefs";
import { cn } from "@/lib/utils";

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return h === 0 ? "12:00 AM" : "12:00 AM";
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
  const zones = useMemo(() => timezoneList(), []);
  const set = (patch: Partial<CalendarPrefs>) => onChange({ ...value, ...patch });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#13131a] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80",
          open && "text-white/80",
        )}
        title="Calendar settings"
        aria-label="Calendar settings"
      >
        <Settings2 className="h-4 w-4" />
      </button>

      {open ? (
        <div
          className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-white/10 bg-[#13131a] p-3.5 shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">Calendar settings</p>

          <div className="space-y-3">
            <Row label="Timezone">
              <select
                value={value.timeZone}
                onChange={(e) => set({ timeZone: e.target.value })}
                className="h-8 max-w-[9.5rem] rounded-lg border border-white/10 bg-[#0f0f13] px-2 text-[12px] text-white/80 focus:border-[#6366f1] focus:outline-none"
              >
                <option value="local">Local (device)</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Row>

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
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-white/70">{label}</span>
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
    <div className="flex rounded-lg border border-white/10 bg-[#0f0f13] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onPick(o.v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === o.v ? "bg-[#6366f1]/[0.18] text-[#c7d2fe]" : "text-white/50 hover:text-white/80",
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
      className="h-8 rounded-lg border border-white/10 bg-[#0f0f13] px-2 text-[12px] text-white/80 focus:border-[#6366f1] focus:outline-none"
    >
      {hours.map((h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </select>
  );
}
