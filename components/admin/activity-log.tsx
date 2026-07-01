"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CalendarPlus,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AuditLog } from "@/lib/types";

const ACTION_META: Record<string, { icon: LucideIcon; iconClass: string; label: string }> = {
  created: { icon: CalendarPlus, iconClass: "text-[#a5b4fc]", label: "Created" },
  status: { icon: RefreshCw, iconClass: "text-[#fbbf24]", label: "Status" },
  scheduled: { icon: CalendarClock, iconClass: "text-[#93c5fd]", label: "Scheduled" },
  payment: { icon: Wallet, iconClass: "text-[#34d399]", label: "Payment" },
};
const actionMeta = (a: string) => ACTION_META[a] ?? { icon: Activity, iconClass: "text-white/50", label: a };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "created", label: "Created" },
  { value: "status", label: "Status" },
  { value: "scheduled", label: "Scheduled" },
  { value: "payment", label: "Payments" },
];

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Earlier this week";
  if (diff < 30) return "This month";
  return "Older";
}
const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "This month", "Older"];

export function ActivityLog({ initial, actors }: { initial: AuditLog[]; actors: Record<string, string> }) {
  const [logs, setLogs] = useState<AuditLog[]>(initial);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
    if (data) setLogs(data as AuditLog[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const filtered = useMemo(
    () => (filter === "all" ? logs : logs.filter((l) => l.action === filter)),
    [logs, filter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, AuditLog[]>();
    for (const l of filtered) {
      const b = dayBucket(l.created_at);
      const arr = map.get(b) ?? [];
      arr.push(l);
      map.set(b, arr);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, rows: map.get(b)! }));
  }, [filtered]);

  const actorName = (id: string | null) => (id ? actors[id] ?? "Someone" : "System");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Activity log</h1>
        <p className="text-[12px] text-white/40">Every change to a request, with who and when.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              filter === f.value
                ? "bg-[#6366f1]/[0.16] text-[#c7d2fe] ring-1 ring-inset ring-[#6366f1]/30"
                : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <SectionCard title="History" description={`${filtered.length} events`} icon={Activity} bodyClassName="p-0 sm:p-0">
        {filtered.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Activity} title="No activity yet" description="Actions on requests will appear here." />
          </div>
        ) : (
          <div>
            {groups.map((g) => (
              <div key={g.bucket}>
                <p className="border-b border-white/[0.06] bg-white/[0.015] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/35 sm:px-6">
                  {g.bucket}
                </p>
                <ul className="divide-y divide-white/[0.05]">
                  {g.rows.map((l) => {
                    const meta = actionMeta(l.action);
                    const Icon = meta.icon;
                    return (
                      <li key={l.id} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                          <Icon className={cn("h-4 w-4", meta.iconClass)} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-white/80">{l.summary}</p>
                          <p className="mt-0.5 text-[11px] text-white/35">
                            {actorName(l.actor_id)} · {relativeTime(l.created_at)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
