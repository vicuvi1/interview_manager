"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CalendarClock,
  Clock,
  ExternalLink,
  Eye,
  Inbox,
  type LucideIcon,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { Calendar, type CalendarEvent } from "@/components/calendar/calendar";
import { Badge, paymentTone, statusTone, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { dateKeyInTimeZone, timeInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { cn, formatMoney, initials } from "@/lib/utils";
import type { CandidateLite, InterviewRequest, ProfileLite } from "@/lib/types";

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}
function pct(cur: number, prev: number): { text: string; dir: "up" | "down" | "flat" } {
  if (prev === 0) return { text: cur > 0 ? "New" : "—", dir: cur > 0 ? "up" : "flat" };
  const change = Math.round(((cur - prev) / prev) * 100);
  return { text: `${change >= 0 ? "+" : ""}${change}% vs last month`, dir: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

const ACTIVITY: Record<string, { tone: Tone; text: string }> = {
  pending: { tone: "indigo", text: "New interview request" },
  approved: { tone: "green", text: "Request approved" },
  scheduled: { tone: "amber", text: "Interview scheduled" },
  completed: { tone: "slate", text: "Interview completed" },
  rejected: { tone: "red", text: "Request rejected" },
  cancelled: { tone: "red", text: "Interview cancelled" },
};

export function AdminDashboard({
  adminTimezone,
  initialRequests,
  initialProfiles,
}: {
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialProfiles: ProfileLite[];
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialProfiles);
  const [managed, setManaged] = useState<InterviewRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) {
      map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    }
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  useDataChanged("interviews", load);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const todayKey = todayKeyInTimeZone(adminTimezone);
  const thisMonth = todayKey.slice(0, 7);
  const lastMonth = prevMonth(thisMonth);

  const stats = useMemo(() => {
    let ivThis = 0, ivLast = 0, revThis = 0, revLast = 0, pending = 0, pendingToday = 0;
    for (const r of requests) {
      if (r.status === "pending") {
        pending++;
        if (dateKeyInTimeZone(r.created_at, adminTimezone) === todayKey) pendingToday++;
      }
      if (r.scheduled_at) {
        const mk = dateKeyInTimeZone(r.scheduled_at, adminTimezone).slice(0, 7);
        if (mk === thisMonth) ivThis++;
        else if (mk === lastMonth) ivLast++;
      }
      if (r.payment_status === "paid" && r.paid_at) {
        const mk = dateKeyInTimeZone(r.paid_at, adminTimezone).slice(0, 7);
        if (mk === thisMonth) revThis += r.price_cents ?? 0;
        else if (mk === lastMonth) revLast += r.price_cents ?? 0;
      }
    }
    let cand = 0, candNew = 0;
    for (const p of profiles) {
      if (p.role !== "admin") {
        cand++;
        if (p.created_at && dateKeyInTimeZone(p.created_at, adminTimezone).slice(0, 7) === thisMonth) candNew++;
      }
    }
    return { ivThis, ivLast, revThis, revLast, pending, pendingToday, cand, candNew };
  }, [requests, profiles, adminTimezone, todayKey, thisMonth, lastMonth]);

  const scheduled = useMemo(
    () => requests.filter((r) => r.scheduled_at && r.status === "scheduled"),
    [requests],
  );
  const events: CalendarEvent[] = useMemo(
    () =>
      scheduled.map((r) => ({
        id: r.id,
        dateKey: dateKeyInTimeZone(r.scheduled_at as string, adminTimezone),
        time: timeInTimeZone(r.scheduled_at as string, adminTimezone),
        label: `${candidates[r.candidate_id]?.full_name || "Candidate"} · ${r.role}`,
        link: r.meeting_link,
      })),
    [scheduled, candidates, adminTimezone],
  );
  const todayEvents = useMemo(
    () =>
      scheduled
        .filter((r) => dateKeyInTimeZone(r.scheduled_at as string, adminTimezone) === todayKey)
        .sort((a, b) => (a.scheduled_at as string).localeCompare(b.scheduled_at as string)),
    [scheduled, adminTimezone, todayKey],
  );

  const invoiced = useMemo(
    () =>
      requests
        .filter((r) => r.price_cents)
        .sort((a, b) => (a.payment_status === "paid" ? 1 : 0) - (b.payment_status === "paid" ? 1 : 0)),
    [requests],
  );

  async function approve(r: InterviewRequest) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ status: "approved" })
      .eq("id", r.id);
    if (!error) {
      await supabase.from("notifications").insert({
        user_id: r.candidate_id,
        title: "Interview approved",
        detail: `Your request for "${r.role}" was approved. A time will follow shortly.`,
        type: "approved",
      });
      toast({ title: "Interview approved", variant: "success" });
      notifyChanged("interviews");
    } else {
      toast({ title: "Action failed", description: error.message, variant: "error" });
    }
    setBusyId(null);
  }

  async function markPaid(r: InterviewRequest) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", r.id);
    if (!error) {
      await supabase.from("notifications").insert({
        user_id: r.candidate_id,
        title: "Payment confirmed",
        detail: `Your payment of ${formatMoney(r.price_cents, r.currency)} was received.`,
        type: "success",
      });
      toast({ title: "Marked as paid", variant: "success" });
      notifyChanged("interviews");
    } else {
      toast({ title: "Couldn't update", description: error.message, variant: "error" });
    }
    setBusyId(null);
  }

  const nowMs = Date.now();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Dashboard</h1>
        <p className="text-[12px] text-white/40">Triage requests, schedule calls, and track revenue.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Interviews this month"
          value={String(stats.ivThis)}
          icon={CalendarClock}
          tone="indigo"
          trend={pct(stats.ivThis, stats.ivLast)}
        />
        <Kpi
          label="Pending approval"
          value={String(stats.pending)}
          icon={Clock}
          tone="amber"
          trend={{ text: `+${stats.pendingToday} today`, dir: stats.pendingToday > 0 ? "up" : "flat" }}
        />
        <Kpi
          label="Revenue this month"
          value={formatMoney(stats.revThis)}
          icon={Wallet}
          tone="green"
          trend={pct(stats.revThis, stats.revLast)}
        />
        <Kpi
          label="Total candidates"
          value={String(stats.cand)}
          icon={Users}
          tone="red"
          trend={{ text: `+${stats.candNew} this month`, dir: stats.candNew > 0 ? "up" : "flat" }}
        />
      </div>

      {/* Requests + Calendar */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Requests" description="Every candidate's request." icon={Inbox} bodyClassName="p-0 sm:p-0">
            {requests.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Inbox} title="No requests yet" description="New requests will appear here." />
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#13131a]">
                    <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                      <th className="px-5 py-2.5 font-medium sm:px-6">Candidate</th>
                      <th className="px-3 py-2.5 font-medium">Role</th>
                      <th className="px-3 py-2.5 font-medium">Preferred</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-5 py-2.5 font-medium sm:px-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {requests.map((r) => {
                      const c = candidates[r.candidate_id];
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-5 py-3 sm:px-6">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
                                {initials(c?.full_name, c?.email)}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-[#f0f0f5]">{c?.full_name || "Unknown"}</p>
                                <p className="truncate text-[11px] text-white/40">{c?.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-white/80">{r.role}</td>
                          <td className="px-3 py-3 text-white/60">
                            {formatInTimeZone(r.preferred_at, c?.timezone ?? "UTC")}
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
                          </td>
                          <td className="px-5 py-3 sm:px-6">
                            <div className="flex items-center justify-end gap-1.5">
                              {r.status === "pending" ? (
                                <Button
                                  size="sm"
                                  loading={busyId === r.id}
                                  disabled={busyId !== null}
                                  onClick={() => approve(r)}
                                >
                                  Approve
                                </Button>
                              ) : null}
                              <Button variant="secondary" size="sm" onClick={() => setManaged(r)}>
                                Manage
                              </Button>
                              <Link
                                href="/admin/candidates"
                                className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                                aria-label="View candidate"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Calendar" description="Scheduled interviews." icon={CalendarClock}>
            <Calendar events={events} timezone={adminTimezone} />
          </SectionCard>
          <SectionCard title="Today" description="Today's schedule." icon={Clock} bodyClassName="p-0 sm:p-0">
            {todayEvents.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Clock} title="Nothing today" description="No interviews scheduled for today." />
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {todayEvents.map((r) => {
                  const startMs = new Date(r.scheduled_at as string).getTime();
                  const soon = startMs - nowMs >= 0 && startMs - nowMs <= 10 * 60000;
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                      <span className="text-[12px] font-medium tabular-nums text-[#a5b4fc]">
                        {timeInTimeZone(r.scheduled_at as string, adminTimezone)}
                      </span>
                      <span className="h-8 w-px bg-gradient-to-b from-[#6366f1] to-[#8b5cf6]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-[#f0f0f5]">
                          {candidates[r.candidate_id]?.full_name || "Candidate"}
                        </p>
                        <p className="truncate text-[11px] text-white/40">{r.role}</p>
                      </div>
                      {r.meeting_link ? (
                        <a
                          href={r.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "rounded-md bg-[#6366f1]/15 px-2 py-1 text-[12px] font-medium text-[#a5b4fc] hover:bg-[#6366f1]/25",
                            soon && "animate-pulse",
                          )}
                        >
                          Join
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Activity + Payments */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Recent activity" description="Latest across the workspace." icon={Activity} bodyClassName="p-0 sm:p-0">
          {requests.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState icon={Activity} title="No activity yet" />
            </div>
          ) : (
            <ul className="max-h-[320px] divide-y divide-white/[0.06] overflow-y-auto scrollbar-thin">
              {requests.slice(0, 10).map((r) => {
                const a = ACTIVITY[r.status] ?? ACTIVITY.pending;
                const c = candidates[r.candidate_id];
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(a.tone))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-white/80">
                        {a.text} · <span className="text-white/55">{c?.full_name || "Candidate"}</span>
                      </p>
                      <p className="truncate text-[11px] text-white/40">{r.role}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-white/30">{relativeTime(r.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Payments" description="Invoices and their status." icon={Wallet} bodyClassName="p-0 sm:p-0">
          {invoiced.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState icon={Wallet} title="No invoices yet" description="Send an invoice from a request's Manage panel." />
            </div>
          ) : (
            <ul className="max-h-[320px] divide-y divide-white/[0.06] overflow-y-auto scrollbar-thin">
              {invoiced.map((r) => {
                const c = candidates[r.candidate_id];
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/50">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-[#f0f0f5]">{c?.full_name || "Candidate"}</p>
                      <p className="truncate text-[11px] text-white/40">{r.role}</p>
                    </div>
                    <span
                      className={cn(
                        "text-[13px] font-medium tabular-nums",
                        r.payment_status === "paid" ? "text-[#34d399]" : "text-[#fbbf24]",
                      )}
                    >
                      {formatMoney(r.price_cents, r.currency)}
                    </span>
                    {r.payment_status === "paid" ? (
                      <Badge tone={paymentTone.paid}>paid</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyId === r.id}
                        disabled={busyId !== null}
                        onClick={() => markPaid(r)}
                      >
                        Mark paid
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {managed ? (
        <ManageRequestDialog
          key={managed.id}
          request={managed}
          candidates={candidates}
          adminTimezone={adminTimezone}
          requests={requests}
          onClose={() => setManaged(null)}
        />
      ) : null}
    </div>
  );
}

function dotClass(tone: Tone): string {
  const map: Record<string, string> = {
    indigo: "bg-[#6366f1]",
    green: "bg-[#34d399]",
    amber: "bg-[#fbbf24]",
    red: "bg-[#f87171]",
    slate: "bg-white/40",
    blue: "bg-[#93c5fd]",
    pink: "bg-[#f9a8d4]",
    purple: "bg-[#c4b5fd]",
  };
  return map[tone] ?? "bg-white/40";
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  trend,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "indigo" | "amber" | "green" | "red";
  trend: { text: string; dir: "up" | "down" | "flat" };
}) {
  const toneCls: Record<string, string> = {
    indigo: "bg-[#6366f1]/10 text-[#a5b4fc]",
    amber: "bg-[#f59e0b]/10 text-[#fbbf24]",
    green: "bg-[#10b981]/10 text-[#34d399]",
    red: "bg-[#ef4444]/10 text-[#f87171]",
  };
  const Trend = trend.dir === "down" ? TrendingDown : TrendingUp;
  const trendCls =
    trend.dir === "up" ? "text-[#34d399]" : trend.dir === "down" ? "text-[#f87171]" : "text-white/30";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneCls[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className={cn("flex items-center gap-1 text-[11px] font-medium", trendCls)}>
          {trend.dir !== "flat" ? <Trend className="h-3 w-3" /> : null}
          {trend.text}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-[#f0f0f5]">{value}</p>
      <p className="mt-0.5 text-[12px] text-white/40">{label}</p>
    </Card>
  );
}
