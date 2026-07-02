"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Search } from "lucide-react";

import { timezoneList } from "@/lib/calendar-prefs";
import { cn } from "@/lib/utils";

// Friendly, searchable common zones (US first, then major world) with keywords.
const COMMON: { tz: string; label: string; kw: string }[] = [
  { tz: "America/New_York", label: "Eastern Time — US", kw: "eastern est edt new york us usa america et" },
  { tz: "America/Chicago", label: "Central Time — US", kw: "central cst cdt chicago us usa america ct" },
  { tz: "America/Denver", label: "Mountain Time — US", kw: "mountain mst mdt denver us usa america mt" },
  { tz: "America/Los_Angeles", label: "Pacific Time — US", kw: "pacific pst pdt los angeles california us usa america pt" },
  { tz: "America/Phoenix", label: "Arizona — US", kw: "arizona phoenix mst us usa" },
  { tz: "America/Anchorage", label: "Alaska — US", kw: "alaska akst anchorage us usa" },
  { tz: "Pacific/Honolulu", label: "Hawaii — US", kw: "hawaii hst honolulu us usa" },
  { tz: "America/Toronto", label: "Toronto — Canada", kw: "toronto canada eastern" },
  { tz: "America/Sao_Paulo", label: "São Paulo — Brazil", kw: "sao paulo brazil brasilia" },
  { tz: "Europe/London", label: "London — UK", kw: "london uk gmt bst britain england europe" },
  { tz: "Europe/Paris", label: "Paris — France", kw: "paris france cet europe" },
  { tz: "Europe/Berlin", label: "Berlin — Germany", kw: "berlin germany cet europe" },
  { tz: "Europe/Madrid", label: "Madrid — Spain", kw: "madrid spain cet europe" },
  { tz: "Europe/Bucharest", label: "Bucharest — Romania", kw: "bucharest romania eet europe" },
  { tz: "Europe/Moscow", label: "Moscow — Russia", kw: "moscow russia msk europe" },
  { tz: "Africa/Cairo", label: "Cairo — Egypt", kw: "cairo egypt africa eet" },
  { tz: "Asia/Dubai", label: "Dubai — UAE", kw: "dubai uae gulf gst asia" },
  { tz: "Asia/Kolkata", label: "India (IST)", kw: "india ist kolkata mumbai delhi asia" },
  { tz: "Asia/Singapore", label: "Singapore", kw: "singapore sgt asia" },
  { tz: "Asia/Hong_Kong", label: "Hong Kong", kw: "hong kong hkt asia china" },
  { tz: "Asia/Tokyo", label: "Tokyo — Japan", kw: "tokyo japan jst asia" },
  { tz: "Australia/Sydney", label: "Sydney — Australia", kw: "sydney australia aest" },
  { tz: "UTC", label: "UTC", kw: "utc gmt universal coordinated" },
];

function offsetLabel(tz: string): string {
  try {
    const zone = tz === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

interface TzEntry {
  tz: string;
  label: string;
  search: string;
  offset: string;
}

/** A dedicated, searchable timezone button (search by "central", "pacific", …). */
export function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<TzEntry[]>(() => {
    const out: TzEntry[] = [{ tz: "local", label: "Local (device)", search: "local device auto current", offset: offsetLabel("local") }];
    const seen = new Set<string>(["local"]);
    for (const c of COMMON) {
      out.push({ tz: c.tz, label: c.label, search: `${c.label} ${c.kw} ${c.tz}`.toLowerCase(), offset: offsetLabel(c.tz) });
      seen.add(c.tz);
    }
    for (const z of timezoneList()) {
      if (seen.has(z)) continue;
      out.push({ tz: z, label: z.replace(/_/g, " "), search: z.replace(/[_/]/g, " ").toLowerCase(), offset: offsetLabel(z) });
    }
    return out;
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter((e) => e.search.includes(s) || e.offset.toLowerCase().includes(s));
  }, [q, entries]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.clearTimeout(t);
    };
  }, [open]);

  const current = entries.find((e) => e.tz === value);
  const currentLabel = current?.label ?? (value === "local" ? "Local" : value.replace(/_/g, " ").split("/").pop() ?? value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-[#13131a] px-3 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white/95",
          open && "bg-white/[0.06] text-white/95",
        )}
        title="Change timezone"
      >
        <Globe className="h-4 w-4 text-[#a5b4fc]" />
        <span className="max-w-[140px] truncate">{currentLabel}</span>
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-[#a5b4fc]">{offsetLabel(value)}</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[21rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#161620] p-2 shadow-2xl shadow-black/50">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search — e.g. central, pacific, eastern…"
              className="h-11 w-full rounded-xl border border-white/12 bg-[#0f0f16] pl-9 pr-3 text-[14px] text-white/90 placeholder:text-white/30 focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30"
            />
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-white/40">No timezone matches &ldquo;{q}&rdquo;.</p>
            ) : (
              filtered.slice(0, 250).map((e) => (
                <button
                  key={e.tz}
                  type="button"
                  onClick={() => {
                    onChange(e.tz);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]",
                    value === e.tz ? "bg-[#6366f1]/[0.12]" : "",
                  )}
                >
                  <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", value === e.tz ? "font-medium text-[#c7d2fe]" : "text-white/80")}>
                    {e.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-white/40">{e.offset}</span>
                  {value === e.tz ? <Check className="h-4 w-4 shrink-0 text-[#6366f1]" /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
