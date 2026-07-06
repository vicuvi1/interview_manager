"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hourglass,
  Video,
  Wallet,
} from "lucide-react";

import { WalletPayDialog } from "@/components/candidate/wallet-pay-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { isOutstandingInvoice } from "@/lib/payments";
import { notifMeta } from "@/lib/notifications";
import { STAGE_LABEL, stageTone } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InterviewRequest, Notification } from "@/lib/types";

const CANCELLABLE = new Set(["pending", "approved", "scheduled"]);
const PAYABLE = new Set(["approved", "scheduled", "completed"]);

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function countdown(target: number, now: number): string {
  const ms = target - now;
  if (ms <= 0) return "Now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export function CandidateDashboard({
  userId,
  name,
  timezone,
  stage,
  initialInterviews,
  initialNotifications,
}: {
  userId: string;
  name: string;
  timezone: string;
  stage?: string | null;
  initialInterviews: InterviewRequest[];
  initialNotifications: Notification[];
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<InterviewRequest[]>(initialInterviews);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [payTarget, setPayTarget] = useState<InterviewRequest | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: iv }, { data: n }] = await Promise.all([
      supabase.from("interview_requests").select("*").eq("candidate_id", userId).order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (iv) setRows(iv as InterviewRequest[]);
    if (n) setNotifications(n as Notification[]);
  }, [userId]);

  useDataChanged("interviews", load);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`cand-dash-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests", filter: `candidate_id=eq.${userId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const nextUp = useMemo(() => {
    return rows
      .filter((r) => r.status === "scheduled" && r.scheduled_at)
      .map((r) => ({ r, start: new Date(r.scheduled_at as string).getTime() }))
      .filter((x) => x.start + (x.r.duration_minutes ?? 30) * 60000 >= now)
      .sort((a, b) => a.start - b.start)[0];
  }, [rows, now]);

  const stats = useMemo(() => {
    let upcoming = 0, completed = 0, pending = 0, outstanding = 0;
    for (const r of rows) {
      if (r.status === "scheduled" && r.scheduled_at && new Date(r.scheduled_at).getTime() >= now) upcoming += 1;
      if (r.status === "completed") completed += 1;
      if (r.status === "pending" || r.status === "approved") pending += 1;
      if (isOutstandingInvoice(r)) outstanding += r.price_cents ?? 0;
    }
    return { upcoming, completed, pending, outstanding };
  }, [rows, now]);

  const outstandingInvoices = useMemo(
    () => rows.filter((r) => isOutstandingInvoice(r)),
    [rows],
  );

  async function cancelRequest(id: string) {
    if (!window.confirm("Cancel this interview request?")) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_my_request", { p_interview_id: id });
    if (error) {
      toast({ title: "Couldn't cancel", description: error.message, variant: "error" });
      return;
    }
    toast({ title: "Request cancelled", variant: "success" });
    notifyChanged("interviews");
  }

  const joinSoon = nextUp ? nextUp.start - now <= 10 * 60000 : false;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-[#6366f1]/[0.12] via-[#8b5cf6]/[0.06] to-transparent p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] text-white/45">{greeting()}</p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-[#f0f0f5]">{name || "there"} 👋</h1>
                {stage ? <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage] ?? stage}</Badge> : null}
              </div>
              {nextUp ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="inline-flex items-center gap-1.5 text-white/70">
                    <CalendarClock className="h-4 w-4 text-[#a5b4fc]" />
                    Next: <span className="font-medium text-[#f0f0f5]">{nextUp.r.role}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-white/55">
                    <Clock className="h-4 w-4 text-white/40" />
                    {formatInTimeZone(nextUp.r.scheduled_at, timezone)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[12px] font-semibold",
                      joinSoon ? "bg-[#34d399]/15 text-[#34d399]" : "bg-white/[0.06] text-white/60",
                    )}
                  >
                    {countdown(nextUp.start, now)}
                  </span>
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-white/55">No interviews scheduled — book one to get started.</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {nextUp?.r.meeting_link ? (
                <a href={nextUp.r.meeting_link} target="_blank" rel="noreferrer">
                  <Button size="sm" className={cn(joinSoon && "animate-pulse")}>
                    <Video className="h-4 w-4" /> Join now
                  </Button>
                </a>
              ) : null}
              <Link href="/candidate/book">
                <Button size="sm" variant={nextUp ? "secondary" : "primary"}>
                  <CalendarPlus className="h-4 w-4" /> Book interview
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Upcoming" value={stats.upcoming} icon={CalendarClock} tone="indigo" />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="green" />
        <StatCard label="In progress" value={stats.pending} icon={Hourglass} tone="amber" />
        <StatCard label="Payments due" value={outstandingInvoices.length} icon={Wallet} tone={outstandingInvoices.length > 0 ? "red" : "slate"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Interviews */}
        <div className="lg:col-span-2">
          <SectionCard
            title="My interviews"
            description="Your requests and their status."
            icon={CalendarCheck}
            bodyClassName="p-0 sm:p-0"
            action={
              <Link href="/candidate/interviews" className="text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]">
                View all
              </Link>
            }
          >
            {rows.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={CalendarCheck} title="No interviews yet" description="Submit a request and it appears here instantly." />
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {rows.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{r.role}</p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-0.5 text-[12px] text-white/50">
                        {r.scheduled_at
                          ? formatInTimeZone(r.scheduled_at, timezone)
                          : `${formatInTimeZone(r.preferred_at, timezone)} (preferred)`}
                        {" · "}
                        {r.duration_minutes} min
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.status === "scheduled" && r.meeting_link ? (
                        <a
                          href={r.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                        >
                          Join <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      {r.payment_status === "paid" ? (
                        <Badge tone="green">paid</Badge>
                      ) : PAYABLE.has(r.status) ? (
                        <Button size="sm" onClick={() => setPayTarget(r)}>
                          Pay
                        </Button>
                      ) : null}
                      {CANCELLABLE.has(r.status) ? (
                        <Button variant="ghost" size="sm" onClick={() => cancelRequest(r.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <SectionCard title="Payments" description="Outstanding invoices." icon={Wallet} bodyClassName="p-0 sm:p-0">
            {outstandingInvoices.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Wallet} title="All settled" description="You have no invoices due." />
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {outstandingInvoices.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{r.role}</p>
                      <p className="text-[12px] text-white/45">Payment due</p>
                    </div>
                    <Button size="sm" onClick={() => setPayTarget(r)}>
                      Pay
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Recent activity"
            description="Latest updates."
            icon={Clock}
            bodyClassName="p-0 sm:p-0"
            action={
              <Link href="/candidate/notifications" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]">
                All <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {notifications.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Clock} title="Nothing yet" />
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {notifications.slice(0, 5).map((n) => {
                  const meta = notifMeta(n.type);
                  const Icon = meta.icon;
                  return (
                    <li key={n.id} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                        <Icon className={cn("h-3.5 w-3.5", meta.iconClass)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{n.title}</p>
                        {n.detail ? <p className="truncate text-[12px] text-white/50">{n.detail}</p> : null}
                        <p className="mt-0.5 text-[11px] text-white/30">{relativeTime(n.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {payTarget ? (
        <WalletPayDialog interviewId={payTarget.id} role={payTarget.role} onClose={() => setPayTarget(null)} />
      ) : null}
    </div>
  );
}
