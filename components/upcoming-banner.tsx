"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ExternalLink, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useDataChanged } from "@/lib/bus";

interface Row {
  id: string;
  role: string;
  scheduled_at: string;
  duration_minutes: number;
  meeting_link: string | null;
}

const WINDOW_BEFORE = 30 * 60_000; // show up to 30 min before start

export function UpcomingBanner({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [now, setNow] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const supabase = createClient();
    const from = new Date(Date.now() - 3 * 3600_000).toISOString();
    const to = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { data } = await supabase
      .from("interview_requests")
      .select("id, role, scheduled_at, duration_minutes, meeting_link")
      .eq("candidate_id", userId)
      .eq("status", "scheduled")
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .order("scheduled_at", { ascending: true });
    if (data) setRows(data as Row[]);
  }, [userId]);

  useEffect(() => {
    load();
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refetch = window.setInterval(load, 120_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(refetch);
    };
  }, [load]);
  useDataChanged("interviews", load);

  if (!now) return null;

  // The interview to highlight: within 30 min of start, until it ends.
  const active = rows.find((r) => {
    if (dismissed.has(r.id)) return false;
    const start = new Date(r.scheduled_at).getTime();
    const end = start + (r.duration_minutes || 30) * 60_000;
    return now >= start - WINDOW_BEFORE && now <= end;
  });
  if (!active) return null;

  const start = new Date(active.scheduled_at).getTime();
  const diff = start - now;
  const ongoing = diff <= 0;
  let countdown: string;
  if (ongoing) {
    countdown = "in progress";
  } else {
    const mins = Math.floor(diff / 60_000);
    const secs = Math.floor((diff % 60_000) / 1000);
    countdown = mins >= 60 ? `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `in ${mins}m ${String(secs).padStart(2, "0")}s`;
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#6366f1]/30 bg-gradient-to-r from-[#6366f1]/[0.14] to-[#8b5cf6]/[0.10] px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#6366f1]/20 text-[#c7d2fe]">
        <CalendarClock className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#f0f0f5]">
          {ongoing ? "Interview in progress" : "Interview starting soon"} · <span className="text-white/70">{active.role}</span>
        </p>
        <p className="text-[12px] text-[#a5b4fc]">{countdown}</p>
      </div>
      {active.meeting_link ? (
        <a
          href={active.meeting_link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#6366f1] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5457e5]"
        >
          Join <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => setDismissed((s) => new Set(s).add(active.id))}
        className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/80"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
