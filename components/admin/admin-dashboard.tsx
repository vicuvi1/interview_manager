"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
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
  X,
} from "lucide-react";

import { CandidatePeek } from "@/components/admin/candidate-peek";
import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { Calendar, type CalendarEvent } from "@/components/calendar/calendar";
import { Badge, paymentTone, type Tone } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { isPayableStatus } from "@/lib/payments";
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
function untilLabel(deltaMs: number): string {
  const mins = Math.round(deltaMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
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
  const [peek, setPeek] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) {
      map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    }
    return map;
  }, [profiles]);

  const colorByCandidate = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of profiles) map[p.id] = p.calendar_color ?? null;
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at, calendar_color"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  useDataChanged("interviews", load);
  useEffect(() => {
    // Debounce live reloads so a burst of changes triggers one refresh.
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (t) clearTimeout(t);
      t = setTimeout(load, 300);
    };
    const supabase = createClient();
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, debounced)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const todayKey = todayKeyInTimeZone(adminTimezone);
  const thisMonth = todayKey.slice(0, 7);
  const lastMonth = prevMonth(thisMonth);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    let ivThis = 0, ivLast = 0, revThis = 0, revLast = 0, revToday = 0, rev7d = 0, pending = 0, pendingToday = 0;
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
        const cents = r.price_cents ?? 0;
        const dk = dateKeyInTimeZone(r.paid_at, adminTimezone);
        const mk = dk.slice(0, 7);
        if (mk === thisMonth) revThis += cents;
        else if (mk === lastMonth) revLast += cents;
        if (dk === todayKey) revToday += cents;
        if (new Date(r.paid_at).getTime() >= weekAgo) rev7d += cents;
      }
    }
    let cand = 0, candNew = 0;
    for (const p of profiles) {
      if (p.role !== "admin") {
        cand++;
        if (p.created_at && dateKeyInTimeZone(p.created_at, adminTimezone).slice(0, 7) === thisMonth) candNew++;
      }
    }
    return { ivThis, ivLast, revThis, revLast, revToday, rev7d, pending, pendingToday, cand, candNew };
  }, [requests, profiles, adminTimezone, todayKey, thisMonth, lastMonth]);

  const attention = useMemo(() => {
    const items: { r: InterviewRequest; kind: string; label: string; tone: Tone; icon: LucideIcon }[] = [];
    for (const r of requests) {
      if (r.status === "pending") items.push({ r, kind: "pending", label: "Pending approval", tone: "indigo", icon: Clock });
      if (r.proposed_at) items.push({ r, kind: "reschedule", label: "Reschedule proposed", tone: "amber", icon: CalendarClock });
      if (r.payment_reported_at && r.payment_status !== "paid")
        items.push({ r, kind: "payment", label: "Payment to confirm", tone: "green", icon: Wallet });
    }
    const order: Record<string, number> = { payment: 0, reschedule: 1, pending: 2 };
    return items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  }, [requests]);

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
        color: r.color ?? colorByCandidate[r.candidate_id] ?? null,
      })),
    [scheduled, candidates, adminTimezone, colorByCandidate],
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
        // Keep paid invoices (collected revenue) but drop unpaid ones that are no
        // longer collectible (cancelled / rejected / still pending).
        .filter((r) => r.price_cents != null && (r.payment_status === "paid" || isPayableStatus(r.status)))
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

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = requests.length > 0 && requests.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => (requests.every((r) => prev.has(r.id)) ? new Set() : new Set(requests.map((r) => r.id))));
  const pendingSelected = useMemo(
    () => requests.filter((r) => selected.has(r.id) && r.status === "pending"),
    [requests, selected],
  );

  async function bulkApprove() {
    const rows = pendingSelected;
    if (rows.length === 0) return;
    setBusyId("bulk");
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ status: "approved" })
      .in("id", rows.map((r) => r.id));
    if (!error) {
      await supabase.from("notifications").insert(
        rows.map((r) => ({
          user_id: r.candidate_id,
          title: "Interview approved",
          detail: `Your request for "${r.role}" was approved. A time will follow shortly.`,
          type: "approved",
        })),
      );
      toast({ title: `Approved ${rows.length} request${rows.length === 1 ? "" : "s"}`, variant: "success" });
      notifyChanged("interviews");
      setSelected(new Set());
    } else {
      toast({ title: "Bulk approve failed", description: error.message, variant: "error" });
    }
    setBusyId(null);
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Keep the "live now / next up" states fresh without a full reload.
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The interview happening right now, or the next one still to come today.
  const liveOrNext = useMemo(() => {
    for (const r of todayEvents) {
      const startMs = new Date(r.scheduled_at as string).getTime();
      const endMs = startMs + (r.duration_minutes ?? 30) * 60000;
      if (now < endMs) return { r, startMs, live: now >= startMs };
    }
    return null;
  }, [todayEvents, now]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Dashboard</h1>
        <p className="text-[12px] text-white/40">Triage requests, schedule calls, and track revenue.</p>
      </div>

      {/* Live now / next up — pinned so today's call and its join link are always in reach. */}
      {liveOrNext ? (() => {
        const { r, startMs, live } = liveOrNext;
        const c = candidates[r.candidate_id];
        return (
          <div
            className={cn(
              "sticky top-0 z-20 flex items-center gap-3 rounded-xl border px-4 py-3 backdrop-blur",
              live ? "border-[#ef4444]/30 bg-[#ef4444]/[0.1]" : "border-[#6366f1]/25 bg-[#13131a]/90",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                live ? "bg-[#ef4444]/15 text-[#f87171]" : "bg-[#6366f1]/15 text-[#a5b4fc]",
              )}
            >
              {live ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f87171]" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
              {live ? "Live now" : "Next up"}
            </span>
            <span className="text-[13px] font-medium tabular-nums text-[#f0f0f5]">
              {timeInTimeZone(r.scheduled_at as string, adminTimezone)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-[#f0f0f5]">
                {c?.full_name || "Candidate"} <span className="text-white/45">· {r.role}</span>
              </p>
              <p className="truncate text-[11px] text-white/40">{live ? "In progress" : untilLabel(startMs - now)}</p>
            </div>
            {r.meeting_link ? (
              <div className="flex items-center gap-1.5">
                <a
                  href={r.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium text-white",
                    live ? "bg-[#ef4444]/90 hover:bg-[#ef4444]" : "bg-[#6366f1] hover:bg-[#6366f1]/90",
                  )}
                >
                  <ExternalLink className="mr-1 inline h-3.5 w-3.5" /> Join
                </a>
                <CopyButton value={r.meeting_link} title="Copy meeting link" className="h-8 w-8" />
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setManaged(r)}>
                Add link
              </Button>
            )}
          </div>
        );
      })() : null}

      {/* Needs attention */}
      {attention.length > 0 ? (
        <SectionCard
          title="Needs attention"
          description="Requests, reschedules, and payments waiting on you."
          icon={AlertTriangle}
          bodyClassName="p-0 sm:p-0"
          action={<Badge tone="amber">{attention.length}</Badge>}
        >
          <ul className="divide-y divide-white/[0.06]">
            {attention.slice(0, 12).map(({ r, kind, label, tone, icon: Icon }) => {
              const c = candidates[r.candidate_id];
              return (
                <li key={`${kind}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => setManaged(r)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.03] sm:px-6"
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", dotBg(tone))}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-[#f0f0f5]">
                        {c?.full_name || "Candidate"} · <span className="text-white/55">{r.role}</span>
                      </p>
                      <p className="truncate text-[11px] text-white/40">{label}</p>
                    </div>
                    <Badge tone={tone}>{label.split(" ")[0]}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi
          label="Collected today"
          value={formatMoney(stats.revToday)}
          icon={Wallet}
          tone="green"
          trend={{ text: "paid today", dir: stats.revToday > 0 ? "up" : "flat" }}
        />
        <Kpi
          label="Collected (last 7 days)"
          value={formatMoney(stats.rev7d)}
          icon={Wallet}
          tone="green"
          trend={{ text: "rolling 7 days", dir: stats.rev7d > 0 ? "up" : "flat" }}
        />
        <Kpi
          label="Revenue this month"
          value={formatMoney(stats.revThis)}
          icon={Wallet}
          tone="green"
          trend={pct(stats.revThis, stats.revLast)}
        />
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
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#6366f1]/[0.05] px-5 py-2.5 sm:px-6">
                <span className="text-[12px] font-medium text-[#c7d2fe]">{selected.size} selected</span>
                <span className="text-[11px] text-white/40">{pendingSelected.length} pending</span>
                <div className="mx-1 h-4 w-px bg-white/10" />
                <Button
                  size="sm"
                  loading={busyId === "bulk"}
                  disabled={busyId !== null || pendingSelected.length === 0}
                  onClick={bulkApprove}
                >
                  Approve{pendingSelected.length > 0 ? ` ${pendingSelected.length}` : ""}
                </Button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="ml-auto rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                  aria-label="Clear selection"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            {requests.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Inbox} title="No requests yet" description="New requests will appear here." />
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#13131a]">
                    <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                      <th className="w-10 px-5 py-2.5 sm:px-6">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-3.5 w-3.5 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-3 py-2.5 font-medium">Candidate</th>
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
                        <tr
                          key={r.id}
                          className={cn("transition-colors hover:bg-white/[0.03]", selected.has(r.id) && "bg-[#6366f1]/[0.04]")}
                        >
                          <td className="px-5 py-3 sm:px-6">
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={() => toggleOne(r.id)}
                              className="h-3.5 w-3.5 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                              aria-label={`Select ${c?.full_name || "candidate"}`}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => setPeek(r.candidate_id)}
                              className="flex items-center gap-2.5 text-left hover:opacity-90"
                              title="Quick view"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
                                {initials(c?.full_name, c?.email)}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-[#f0f0f5]">{c?.full_name || "Unknown"}</p>
                                <p className="truncate text-[11px] text-white/40">{c?.email}</p>
                              </div>
                            </button>
                          </td>
                          <td className="px-3 py-3 text-white/80">{r.role}</td>
                          <td className="px-3 py-3 text-white/60">
                            {formatInTimeZone(r.preferred_at, c?.timezone ?? "UTC")}
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge status={r.status} />
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
                              <button
                                type="button"
                                onClick={() => setPeek(r.candidate_id)}
                                className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                                aria-label="Quick view candidate"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
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
                  const endMs = startMs + (r.duration_minutes ?? 30) * 60000;
                  const live = now >= startMs && now < endMs;
                  const ended = now >= endMs;
                  const soon = !live && !ended && startMs - now <= 10 * 60000;
                  return (
                    <li key={r.id} className={cn("flex items-center gap-3 px-5 py-3 sm:px-6", ended && "opacity-45")}>
                      <span className="flex w-12 shrink-0 flex-col">
                        <span className="text-[12px] font-medium tabular-nums text-[#a5b4fc]">
                          {timeInTimeZone(r.scheduled_at as string, adminTimezone)}
                        </span>
                        <span className="text-[10px] text-white/35">
                          {live ? "" : ended ? "ended" : untilLabel(startMs - now)}
                        </span>
                      </span>
                      <span
                        className={cn("h-8 w-px", live ? "bg-[#f87171]" : "bg-gradient-to-b from-[#6366f1] to-[#8b5cf6]")}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-[#f0f0f5]">
                          {candidates[r.candidate_id]?.full_name || "Candidate"}
                        </p>
                        <p className="truncate text-[11px] text-white/40">{r.role}</p>
                      </div>
                      {live ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#f87171]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f87171]" /> Live
                        </span>
                      ) : null}
                      {r.meeting_link && !ended ? (
                        <div className="flex items-center gap-1">
                          <a
                            href={r.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              "rounded-md px-2 py-1 text-[12px] font-medium",
                              live
                                ? "bg-[#ef4444]/15 text-[#f87171] hover:bg-[#ef4444]/25"
                                : "bg-[#6366f1]/15 text-[#a5b4fc] hover:bg-[#6366f1]/25",
                              (live || soon) && "animate-pulse",
                            )}
                          >
                            Join
                          </a>
                          <CopyButton value={r.meeting_link} title="Copy meeting link" className="h-7 w-7" />
                        </div>
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
      {peek ? (
        <CandidatePeek
          candidateId={peek}
          seed={candidates[peek]}
          adminTimezone={adminTimezone}
          onClose={() => setPeek(null)}
        />
      ) : null}
    </div>
  );
}

function dotBg(tone: Tone): string {
  const map: Record<string, string> = {
    indigo: "bg-[#6366f1]/12 text-[#a5b4fc]",
    green: "bg-[#10b981]/12 text-[#34d399]",
    amber: "bg-[#f59e0b]/12 text-[#fbbf24]",
    red: "bg-[#ef4444]/12 text-[#f87171]",
    slate: "bg-white/[0.06] text-white/60",
    blue: "bg-[#3b82f6]/12 text-[#93c5fd]",
    pink: "bg-[#ec4899]/12 text-[#f9a8d4]",
    purple: "bg-[#8b5cf6]/12 text-[#c4b5fd]",
  };
  return map[tone] ?? "bg-white/[0.06] text-white/60";
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
