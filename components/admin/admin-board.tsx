"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Inbox,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { Badge, paymentTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { StatCard } from "@/components/admin/stat-card";
import { dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/client";
import {
  formatInTimeZone,
  relativeTime,
  utcToLocalInput,
  wallTimeToUtcISO,
} from "@/lib/time";
import { formatMoney, initials } from "@/lib/utils";
import type { CandidateLite, InterviewRequest, InterviewStatus } from "@/lib/types";

type ActionKind = "approve" | "reject" | "complete" | "cancel";

const ACTIONS: Record<
  ActionKind,
  {
    target: InterviewStatus;
    label: string;
    variant: "primary" | "secondary" | "danger";
    title: string;
    type: string;
  }
> = {
  approve: { target: "approved", label: "Approve", variant: "primary", title: "Interview approved", type: "approved" },
  reject: { target: "rejected", label: "Reject", variant: "danger", title: "Interview not approved", type: "rejected" },
  complete: { target: "completed", label: "Mark completed", variant: "primary", title: "Interview completed", type: "success" },
  cancel: { target: "cancelled", label: "Cancel", variant: "secondary", title: "Interview cancelled", type: "alert" },
};

const ACTIONS_BY_STATUS: Record<string, ActionKind[]> = {
  pending: ["approve", "reject"],
  approved: ["complete", "cancel"],
  scheduled: ["complete", "cancel"],
  rejected: [],
  completed: [],
  cancelled: [],
};

const FILTERS = ["all", "pending", "approved", "scheduled", "completed", "rejected", "cancelled"];

function defaultDetail(kind: ActionKind, role: string): string {
  switch (kind) {
    case "approve":
      return `Your request for "${role}" was approved. A time will follow shortly.`;
    case "reject":
      return `Your request for "${role}" was not approved.`;
    case "complete":
      return `Your interview for "${role}" is complete. Thank you!`;
    case "cancel":
      return `Your interview for "${role}" was cancelled.`;
  }
}

export function AdminBoard({
  adminTimezone,
  initialRequests,
  initialCandidates,
}: {
  adminId: string;
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialCandidates: Record<string, CandidateLite>;
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [candidates, setCandidates] = useState<Record<string, CandidateLite>>(initialCandidates);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<InterviewRequest | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schedAt, setSchedAt] = useState("");
  const [schedDuration, setSchedDuration] = useState(30);
  const [schedLink, setSchedLink] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoicing, setInvoicing] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setSchedAt(selected.scheduled_at ? utcToLocalInput(selected.scheduled_at, adminTimezone) : "");
    setSchedDuration(selected.duration_minutes);
    setSchedLink(selected.meeting_link ?? "");
    setInvoiceAmount(selected.price_cents ? (selected.price_cents / 100).toFixed(2) : "");
  }, [selected, adminTimezone]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (profs) {
      const map: Record<string, CandidateLite> = {};
      for (const p of profs as (CandidateLite & { id: string })[]) {
        map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
      }
      setCandidates(map);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-interviews")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interview_requests" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, scheduled: 0, completed: 0 };
    for (const r of requests) {
      if (r.status in c) c[r.status as keyof typeof c] += 1;
    }
    return c;
  }, [requests]);

  const revenue = useMemo(() => {
    let earned = 0;
    let month = 0;
    let outstanding = 0;
    let paidCount = 0;
    const monthKey = todayKeyInTimeZone(adminTimezone).slice(0, 7);
    for (const r of requests) {
      if (r.payment_status === "paid") {
        earned += r.price_cents ?? 0;
        paidCount += 1;
        if (r.paid_at && dateKeyInTimeZone(r.paid_at, adminTimezone).slice(0, 7) === monthKey) {
          month += r.price_cents ?? 0;
        }
      } else if (r.price_cents) {
        outstanding += r.price_cents;
      }
    }
    return { earned, month, outstanding, paidCount };
  }, [requests, adminTimezone]);

  const visible = useMemo(
    () => (filter === "all" ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter],
  );

  async function runAction(kind: ActionKind) {
    if (!selected) return;
    const action = ACTIONS[kind];
    setBusy(kind);
    setError(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({ status: action.target })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Action failed", description: updateError.message, variant: "error" });
      setBusy(null);
      return;
    }

    const detail = message.trim() || defaultDetail(kind, selected.role);
    await supabase.from("notifications").insert({
      user_id: selected.candidate_id,
      title: action.title,
      detail,
      type: action.type,
    });

    toast({ title: action.title, variant: "success" });
    setBusy(null);
    setMessage("");
    setSelected(null);
    load();
  }

  async function schedule() {
    if (!selected) return;
    if (!schedAt) {
      setError("Pick a date and time.");
      return;
    }
    setScheduling(true);
    setError(null);
    const supabase = createClient();
    const scheduledUtc = wallTimeToUtcISO(schedAt, adminTimezone);
    const candidateTz = candidates[selected.candidate_id]?.timezone ?? "UTC";

    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({
        scheduled_at: scheduledUtc,
        meeting_link: schedLink.trim() || null,
        duration_minutes: schedDuration,
        status: "scheduled",
      })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Scheduling failed", description: updateError.message, variant: "error" });
      setScheduling(false);
      return;
    }

    await supabase.from("notifications").insert({
      user_id: selected.candidate_id,
      title: "Interview scheduled",
      detail: `Your interview for "${selected.role}" is set for ${formatInTimeZone(scheduledUtc, candidateTz)}.`,
      type: "approved",
    });

    toast({ title: "Interview scheduled", variant: "success" });
    setScheduling(false);
    setSelected(null);
    load();
  }

  async function sendInvoice() {
    if (!selected) return;
    const cents = Math.round(parseFloat(invoiceAmount) * 100);
    if (!cents || cents <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setInvoicing(true);
    setError(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({ price_cents: cents, currency: "USD" })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Couldn't send invoice", description: updateError.message, variant: "error" });
      setInvoicing(false);
      return;
    }

    await supabase.from("notifications").insert({
      user_id: selected.candidate_id,
      title: "Payment requested",
      detail: `A payment of ${formatMoney(cents, "USD")} is due for "${selected.role}".`,
      type: "alert",
    });

    toast({ title: "Invoice sent", variant: "success" });
    setInvoicing(false);
    setSelected(null);
    load();
  }

  const selectedCandidate = selected ? candidates[selected.candidate_id] : undefined;
  const selectedActions = selected ? ACTIONS_BY_STATUS[selected.status] ?? [] : [];
  const candTz = selectedCandidate?.timezone ?? "UTC";
  let schedPreview: string | null = null;
  let schedConflict: string | null = null;
  if (selected && schedAt) {
    try {
      const startIso = wallTimeToUtcISO(schedAt, adminTimezone);
      schedPreview = formatInTimeZone(startIso, candTz);
      const start = new Date(startIso).getTime();
      const end = start + schedDuration * 60000;
      for (const r of requests) {
        if (r.id === selected.id || r.status !== "scheduled" || !r.scheduled_at) continue;
        const otherStart = new Date(r.scheduled_at).getTime();
        const otherEnd = otherStart + (r.duration_minutes ?? 0) * 60000;
        if (start < otherEnd && otherStart < end) {
          const who = candidates[r.candidate_id]?.full_name || "another candidate";
          schedConflict = `Overlaps ${who} at ${formatInTimeZone(r.scheduled_at, adminTimezone)}`;
          break;
        }
      }
    } catch {
      schedPreview = null;
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[13px] font-medium text-white/55">Revenue</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Earned" value={formatMoney(revenue.earned)} icon={Wallet} tone="green" />
          <StatCard
            label="This month"
            value={formatMoney(revenue.month)}
            icon={TrendingUp}
            tone="indigo"
          />
          <StatCard
            label="Outstanding"
            value={formatMoney(revenue.outstanding)}
            icon={Receipt}
            tone="amber"
          />
          <StatCard label="Paid" value={revenue.paidCount} icon={CreditCard} tone="blue" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-white/55">Pipeline</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Pending" value={counts.pending} icon={Clock} tone="amber" />
          <StatCard label="Approved" value={counts.approved} icon={CalendarCheck} tone="green" />
          <StatCard label="Scheduled" value={counts.scheduled} icon={CalendarClock} tone="blue" />
          <StatCard label="Completed" value={counts.completed} icon={CheckCircle2} tone="indigo" />
        </div>
      </div>

      <SectionCard
        title="Interview requests"
        description="Every candidate's request, updating live."
        icon={Users}
        bodyClassName="p-0 sm:p-0"
        action={
          <div className="w-40">
            <Select
              aria-label="Filter by status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f === "all" ? "All statuses" : f}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {visible.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              icon={Inbox}
              title="Nothing here"
              description="No requests match this filter yet."
            />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[12px] uppercase tracking-wide text-white/40">
                  <th className="px-5 py-3 font-medium sm:px-6">Candidate</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Preferred</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Payment</th>
                  <th className="px-5 py-3 font-medium sm:px-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visible.map((r) => {
                  const c = candidates[r.candidate_id];
                  const tz = c?.timezone ?? "UTC";
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-3 sm:px-6">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
                            {initials(c?.full_name, c?.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[#f0f0f5]">
                              {c?.full_name || "Unknown"}
                            </p>
                            <p className="truncate text-[12px] text-white/40">{c?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-white/80">{r.role}</td>
                      <td className="px-3 py-3 text-white/60">
                        {formatInTimeZone(r.preferred_at, tz)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={paymentTone[r.payment_status] ?? "slate"}>
                          {r.payment_status}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right sm:px-6">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelected(r);
                            setMessage("");
                            setError(null);
                          }}
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Manage request"
        description={selected ? selected.role : undefined}
      >
        {selected ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="col-span-2">
                <dt className="text-[12px] uppercase tracking-wide text-white/40">Candidate</dt>
                <dd className="text-[#f0f0f5]">
                  {selectedCandidate?.full_name || "Unknown"}{" "}
                  <span className="text-white/40">· {selectedCandidate?.email}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-white/40">Preferred</dt>
                <dd className="text-white/80">
                  {formatInTimeZone(selected.preferred_at, selectedCandidate?.timezone ?? "UTC")}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-white/40">Duration</dt>
                <dd className="text-white/80">{selected.duration_minutes} min</dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-white/40">Status</dt>
                <dd>
                  <Badge tone={statusTone[selected.status] ?? "slate"}>{selected.status}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wide text-white/40">Requested</dt>
                <dd className="text-white/80">{relativeTime(selected.created_at)}</dd>
              </div>
              {selected.notes ? (
                <div className="col-span-2">
                  <dt className="text-[12px] uppercase tracking-wide text-white/40">Notes</dt>
                  <dd className="whitespace-pre-wrap text-white/80">{selected.notes}</dd>
                </div>
              ) : null}
            </dl>

            {selected.status === "approved" || selected.status === "scheduled" ? (
              <div className="space-y-3 border-t border-white/[0.06] pt-4">
                <p className="text-[13px] font-medium text-white/80">
                  {selected.status === "scheduled" ? "Reschedule" : "Schedule a time"}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Date & time (${adminTimezone})`} htmlFor="schedAt">
                    <Input
                      id="schedAt"
                      type="datetime-local"
                      value={schedAt}
                      onChange={(e) => setSchedAt(e.target.value)}
                    />
                  </Field>
                  <Field label="Duration" htmlFor="schedDur">
                    <Select
                      id="schedDur"
                      value={schedDuration}
                      onChange={(e) => setSchedDuration(Number(e.target.value))}
                    >
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>60 minutes</option>
                      <option value={90}>90 minutes</option>
                    </Select>
                  </Field>
                </div>
                <Field
                  label="Meeting link"
                  htmlFor="schedLink"
                  hint="Optional — shared with the candidate."
                >
                  <Input
                    id="schedLink"
                    placeholder="https://meet.google.com/…"
                    value={schedLink}
                    onChange={(e) => setSchedLink(e.target.value)}
                  />
                </Field>
                {schedPreview ? (
                  <p className="text-[13px] text-white/55">
                    Candidate ({candTz}) sees:{" "}
                    <span className="font-medium text-white/80">{schedPreview}</span>
                  </p>
                ) : null}
                {schedConflict ? (
                  <p className="rounded-lg bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[#fbbf24] ring-1 ring-inset ring-[#f59e0b]/30">
                    Heads up: {schedConflict}.
                  </p>
                ) : null}
                <Button size="sm" loading={scheduling} disabled={scheduling} onClick={schedule}>
                  <CalendarClock className="h-4 w-4" />
                  {selected.status === "scheduled" ? "Update time" : "Confirm schedule"}
                </Button>
              </div>
            ) : null}

            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <p className="text-[13px] font-medium text-white/80">Payment</p>
              {selected.payment_status === "paid" ? (
                <p className="text-[13px] font-medium text-[#34d399]">
                  Paid {formatMoney(selected.price_cents, selected.currency)}
                  {selected.paid_at ? ` · ${relativeTime(selected.paid_at)}` : ""}
                </p>
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label="Invoice amount (USD)" htmlFor="invoice">
                        <Input
                          id="invoice"
                          inputMode="decimal"
                          placeholder="50.00"
                          value={invoiceAmount}
                          onChange={(e) => setInvoiceAmount(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={invoicing}
                      disabled={invoicing}
                      onClick={sendInvoice}
                    >
                      {selected.price_cents ? "Update invoice" : "Send invoice"}
                    </Button>
                  </div>
                  {selected.price_cents ? (
                    <p className="text-[12px] text-white/40">
                      Invoiced {formatMoney(selected.price_cents, selected.currency)} · awaiting
                      payment
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {selectedActions.length > 0 ? (
              <div className="space-y-3 border-t border-white/[0.06] pt-4">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional message to the candidate…"
                  className="min-h-[64px]"
                />
                {error ? <p className="text-[13px] text-[#f87171]">{error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {selectedActions.map((kind) => (
                    <Button
                      key={kind}
                      variant={ACTIONS[kind].variant}
                      size="sm"
                      loading={busy === kind}
                      disabled={busy !== null}
                      onClick={() => runAction(kind)}
                    >
                      {ACTIONS[kind].label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="border-t border-white/[0.06] pt-4 text-[13px] text-white/55">
                This request is {selected.status} — no further actions.
              </p>
            )}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
