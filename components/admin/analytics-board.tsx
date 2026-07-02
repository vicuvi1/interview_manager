"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Star, TrendingUp, UserX, Users, Wallet } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { completionRate, computeFunnel, lastMonths, statusCounts, sumPaid } from "@/lib/analytics";
import { useDataChanged } from "@/lib/bus";
import { useDebouncedCallback } from "@/lib/use-debounced";
import { MONTH_NAMES, dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { formatAmount } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import type { InterviewFeedback, InterviewRequest, Payment } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  pending: "#fbbf24",
  approved: "#34d399",
  scheduled: "#a5b4fc",
  completed: "#94a3b8",
  cancelled: "#f87171",
  rejected: "#f87171",
};

export function AnalyticsBoard({
  adminTimezone,
  initialRequests,
  initialPayments,
}: {
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialPayments: Payment[];
}) {
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [feedback, setFeedback] = useState<InterviewFeedback[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: pays }, { data: fb }] = await Promise.all([
      supabase.from("interview_requests").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("interview_feedback").select("outcome, rating"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (pays) setPayments(pays as Payment[]);
    if (fb) setFeedback(fb as InterviewFeedback[]);
  }, []);

  const reload = useDebouncedCallback(load);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-analytics")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_feedback" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);
  useDataChanged("interviews", load);

  const total = requests.length;
  const byStatus = useMemo(() => statusCounts(requests), [requests]);
  const funnel = useMemo(() => computeFunnel(requests), [requests]);
  const rate = useMemo(() => completionRate(requests), [requests]);
  const totalRevenue = useMemo(() => sumPaid(payments), [payments]);

  const months = useMemo(
    () => lastMonths(todayKeyInTimeZone(adminTimezone).slice(0, 7), 6),
    [adminTimezone],
  );

  const requestsByMonth = useMemo(
    () =>
      months.map((m) => {
        let n = 0;
        for (const r of requests) if (dateKeyInTimeZone(r.created_at, adminTimezone).slice(0, 7) === m) n += 1;
        return { m, n };
      }),
    [months, requests, adminTimezone],
  );

  const revenueByMonth = useMemo(
    () =>
      months.map((m) => {
        let v = 0;
        for (const p of payments)
          if (p.status === "paid" && p.paid_at && dateKeyInTimeZone(p.paid_at, adminTimezone).slice(0, 7) === m)
            v += Number(p.amount) || 0;
        return { m, v };
      }),
    [months, payments, adminTimezone],
  );

  const topRoles = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of requests) c.set(r.role, (c.get(r.role) ?? 0) + 1);
    return Array.from(c.entries())
      .map(([role, n]) => ({ role, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
  }, [requests]);

  const byStage = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of requests) {
      const key = r.interview_type || "Unspecified";
      c.set(key, (c.get(key) ?? 0) + 1);
    }
    return Array.from(c.entries())
      .map(([stage, n]) => ({ stage, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [requests]);

  const quality = useMemo(() => {
    const rated = feedback.filter((f) => f.rating != null);
    const avgRating = rated.length ? rated.reduce((s, f) => s + (f.rating ?? 0), 0) / rated.length : 0;
    const withOutcome = feedback.filter((f) => f.outcome === "no_show" || f.outcome === "advance" || f.outcome === "hold" || f.outcome === "reject");
    const noShows = feedback.filter((f) => f.outcome === "no_show").length;
    const noShowRate = withOutcome.length ? Math.round((noShows / withOutcome.length) * 100) : 0;
    return { avgRating, ratedCount: rated.length, noShowRate, hasOutcomes: withOutcome.length > 0 };
  }, [feedback]);

  const funnelMax = Math.max(1, funnel[0]?.value ?? 1);
  const reqMax = Math.max(1, ...requestsByMonth.map((x) => x.n));
  const revMax = Math.max(1, ...revenueByMonth.map((x) => x.v));
  const monthLabel = (m: string) => MONTH_NAMES[Number(m.split("-")[1]) - 1].slice(0, 3);

  if (total === 0 && payments.length === 0) {
    return (
      <div className="space-y-5">
        <Header />
        <SectionCard title="Overview" icon={BarChart3}>
          <EmptyState icon={BarChart3} title="No data yet" description="Analytics populate as requests come in." />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total requests" value={total} icon={Users} tone="indigo" />
        <StatCard label="Scheduled" value={(byStatus.scheduled ?? 0) + (byStatus.completed ?? 0)} icon={TrendingUp} tone="blue" />
        <StatCard label="Completion rate" value={`${rate}%`} icon={CheckCircle2} tone="green" />
        <StatCard label="Total revenue" value={formatAmount(totalRevenue)} icon={Wallet} tone="green" />
        <StatCard
          label="Avg rating"
          value={quality.ratedCount ? `${quality.avgRating.toFixed(1)}★` : "—"}
          icon={Star}
          tone="amber"
        />
        <StatCard label="No-show rate" value={quality.hasOutcomes ? `${quality.noShowRate}%` : "—"} icon={UserX} tone="red" />
        <StatCard label="Feedback given" value={feedback.length} icon={CheckCircle2} tone="indigo" />
        <StatCard label="Completed" value={byStatus.completed ?? 0} icon={CheckCircle2} tone="green" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Conversion funnel" description="From request to completed interview." icon={TrendingUp}>
          <div className="space-y-3">
            {funnel.map((f, i) => {
              const pct = Math.round((f.value / funnelMax) * 100);
              const conv = i === 0 || funnel[0].value === 0 ? 100 : Math.round((f.value / funnel[0].value) * 100);
              return (
                <div key={f.label}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-white/70">{f.label}</span>
                    <span className="tabular-nums text-white/50">
                      {f.value} · {conv}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Status breakdown" description="All requests by status." icon={BarChart3}>
          <div className="space-y-2.5">
            {Object.keys(byStatus).length === 0 ? (
              <EmptyState icon={BarChart3} title="No requests yet" />
            ) : (
              Object.entries(byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-[12px] capitalize text-white/55">{status}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(n / total) * 100}%`, backgroundColor: STATUS_COLORS[status] ?? "#94a3b8" }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-white/70">{n}</span>
                  </div>
                ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Requests over time" description="Last 6 months." icon={BarChart3}>
          <div className="flex h-40 items-end gap-2">
            {requestsByMonth.map((x) => (
              <div key={x.m} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-[#6366f1] to-[#8b5cf6]"
                    style={{ height: `${Math.max(2, (x.n / reqMax) * 100)}%` }}
                    title={`${x.n} requests`}
                  />
                </div>
                <span className="text-[10px] text-white/40">{monthLabel(x.m)}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Revenue over time" description="Paid, last 6 months." icon={Wallet}>
          <div className="flex h-40 items-end gap-2">
            {revenueByMonth.map((x) => (
              <div key={x.m} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-[#10b981] to-[#34d399]"
                    style={{ height: `${Math.max(2, (x.v / revMax) * 100)}%` }}
                    title={formatAmount(x.v)}
                  />
                </div>
                <span className="text-[10px] text-white/40">{monthLabel(x.m)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Top roles" description="Most requested roles." icon={Users}>
          {topRoles.length === 0 ? (
            <EmptyState icon={Users} title="No roles yet" />
          ) : (
            <div className="space-y-2.5">
              {topRoles.map((r) => (
                <div key={r.role} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-[12px] text-white/70">{r.role}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
                      style={{ width: `${(r.n / topRoles[0].n) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-white/70">{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="By stage" description="Requests by interview type." icon={BarChart3}>
          {byStage.length === 0 ? (
            <EmptyState icon={BarChart3} title="No data yet" />
          ) : (
            <div className="space-y-2.5">
              {byStage.map((s) => (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-[12px] text-white/70">{s.stage}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#14b8a6] to-[#34d399]"
                      style={{ width: `${(s.n / byStage[0].n) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-white/70">{s.n}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-medium text-[#f0f0f5]">Analytics</h1>
      <p className="text-[12px] text-white/40">Funnel, conversion, and trends across all activity.</p>
    </div>
  );
}
