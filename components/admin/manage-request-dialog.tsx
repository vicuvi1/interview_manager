"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { FORMAT_LABEL } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import {
  formatInTimeZone,
  relativeTime,
  utcToLocalInput,
  wallTimeToUtcISO,
} from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import type { CandidateLite, InterviewRequest, InterviewStatus } from "@/lib/types";

type ActionKind = "approve" | "reject" | "complete" | "cancel";

const ACTIONS: Record<
  ActionKind,
  { target: InterviewStatus; label: string; variant: "primary" | "secondary" | "danger"; title: string; type: string }
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

export function ManageRequestDialog({
  request,
  candidates,
  adminTimezone,
  requests,
  onClose,
}: {
  request: InterviewRequest;
  candidates: Record<string, CandidateLite>;
  adminTimezone: string;
  requests: InterviewRequest[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schedAt, setSchedAt] = useState(
    request.scheduled_at ? utcToLocalInput(request.scheduled_at, adminTimezone) : "",
  );
  const [schedDuration, setSchedDuration] = useState(request.duration_minutes);
  const [schedLink, setSchedLink] = useState(request.meeting_link ?? "");
  const [scheduling, setScheduling] = useState(false);

  const [invoiceAmount, setInvoiceAmount] = useState(
    request.price_cents ? (request.price_cents / 100).toFixed(2) : "",
  );
  const [invoicing, setInvoicing] = useState(false);

  const candidate = candidates[request.candidate_id];
  const candTz = candidate?.timezone ?? "UTC";
  const actions = ACTIONS_BY_STATUS[request.status] ?? [];

  let schedPreview: string | null = null;
  let schedConflict: string | null = null;
  if (schedAt) {
    try {
      const startIso = wallTimeToUtcISO(schedAt, adminTimezone);
      schedPreview = formatInTimeZone(startIso, candTz);
      const start = new Date(startIso).getTime();
      const end = start + schedDuration * 60000;
      for (const r of requests) {
        if (r.id === request.id || r.status !== "scheduled" || !r.scheduled_at) continue;
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

  async function runAction(kind: ActionKind) {
    const action = ACTIONS[kind];
    setBusy(kind);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({ status: action.target })
      .eq("id", request.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Action failed", description: updateError.message, variant: "error" });
      setBusy(null);
      return;
    }
    const detail = message.trim() || defaultDetail(kind, request.role);
    await supabase.from("notifications").insert({
      user_id: request.candidate_id,
      title: action.title,
      detail,
      type: action.type,
    });
    toast({ title: action.title, variant: "success" });
    setBusy(null);
    notifyChanged("interviews");
    onClose();
  }

  async function schedule() {
    if (!schedAt) {
      setError("Pick a date and time.");
      return;
    }
    setScheduling(true);
    setError(null);
    const supabase = createClient();
    const scheduledUtc = wallTimeToUtcISO(schedAt, adminTimezone);
    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({
        scheduled_at: scheduledUtc,
        meeting_link: schedLink.trim() || null,
        duration_minutes: schedDuration,
        status: "scheduled",
      })
      .eq("id", request.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Scheduling failed", description: updateError.message, variant: "error" });
      setScheduling(false);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: request.candidate_id,
      title: "Interview scheduled",
      detail: `Your interview for "${request.role}" is set for ${formatInTimeZone(scheduledUtc, candTz)}.`,
      type: "approved",
    });
    toast({ title: "Interview scheduled", variant: "success" });
    setScheduling(false);
    notifyChanged("interviews");
    onClose();
  }

  async function sendInvoice() {
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
      .eq("id", request.id);
    if (updateError) {
      setError(updateError.message);
      toast({ title: "Couldn't send invoice", description: updateError.message, variant: "error" });
      setInvoicing(false);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: request.candidate_id,
      title: "Payment requested",
      detail: `A payment of ${formatMoney(cents, "USD")} is due for "${request.role}".`,
      type: "alert",
    });
    toast({ title: "Invoice sent", variant: "success" });
    setInvoicing(false);
    notifyChanged("interviews");
    onClose();
  }

  const canSchedule = request.status === "approved" || request.status === "scheduled";

  return (
    <Dialog open onClose={onClose} title="Manage request" description={request.role}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div className="col-span-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/40">Candidate</dt>
            <dd className="text-[#f0f0f5]">
              {candidate?.full_name || "Unknown"}{" "}
              <span className="text-white/40">· {candidate?.email}</span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-white/40">Preferred</dt>
            <dd className="text-white/80">{formatInTimeZone(request.preferred_at, candTz)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-white/40">Duration</dt>
            <dd className="text-white/80">{request.duration_minutes} min</dd>
          </div>
          {request.interview_type ? (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Type</dt>
              <dd className="text-white/80">{request.interview_type}</dd>
            </div>
          ) : null}
          {request.level ? (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Level</dt>
              <dd className="text-white/80">{request.level}</dd>
            </div>
          ) : null}
          {request.format ? (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Format</dt>
              <dd className="text-white/80">{FORMAT_LABEL[request.format] ?? request.format}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-white/40">Status</dt>
            <dd>
              <Badge tone={statusTone[request.status] ?? "slate"}>{request.status}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-white/40">Requested</dt>
            <dd className="text-white/80">{relativeTime(request.created_at)}</dd>
          </div>
          {request.focus_areas && request.focus_areas.length ? (
            <div className="col-span-2">
              <dt className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Focus areas</dt>
              <dd className="flex flex-wrap gap-1.5">
                {request.focus_areas.map((f) => (
                  <span key={f} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-white/70">
                    {f}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {request.goals ? (
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Goals</dt>
              <dd className="whitespace-pre-wrap text-white/80">{request.goals}</dd>
            </div>
          ) : null}
          {request.notes ? (
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Notes</dt>
              <dd className="whitespace-pre-wrap text-white/80">{request.notes}</dd>
            </div>
          ) : null}
        </dl>

        {canSchedule ? (
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <p className="text-[13px] font-medium text-white/80">
              {request.status === "scheduled" ? "Reschedule" : "Schedule a time"}
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
            <Field label="Meeting link" htmlFor="schedLink" hint="Optional — shared with the candidate.">
              <Input
                id="schedLink"
                placeholder="https://meet.google.com/…"
                value={schedLink}
                onChange={(e) => setSchedLink(e.target.value)}
              />
            </Field>
            {schedPreview ? (
              <p className="text-[12px] text-white/55">
                Candidate ({candTz}) sees:{" "}
                <span className="font-medium text-white/80">{schedPreview}</span>
              </p>
            ) : null}
            {schedConflict ? (
              <p className="rounded-lg bg-[#f59e0b]/10 px-3 py-2 text-[11px] text-[#fbbf24] ring-1 ring-inset ring-[#f59e0b]/30">
                Heads up: {schedConflict}.
              </p>
            ) : null}
            <Button size="sm" loading={scheduling} disabled={scheduling} onClick={schedule}>
              <CalendarClock className="h-4 w-4" />
              {request.status === "scheduled" ? "Update time" : "Confirm schedule"}
            </Button>
          </div>
        ) : null}

        <div className="space-y-3 border-t border-white/[0.06] pt-4">
          <p className="text-[13px] font-medium text-white/80">Payment</p>
          {request.payment_status === "paid" ? (
            <p className="text-[13px] font-medium text-[#34d399]">
              Paid {formatMoney(request.price_cents, request.currency)}
              {request.paid_at ? ` · ${relativeTime(request.paid_at)}` : ""}
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
                <Button variant="secondary" size="sm" loading={invoicing} disabled={invoicing} onClick={sendInvoice}>
                  {request.price_cents ? "Update invoice" : "Send invoice"}
                </Button>
              </div>
              {request.price_cents ? (
                <p className="text-[11px] text-white/40">
                  Invoiced {formatMoney(request.price_cents, request.currency)} · awaiting payment
                </p>
              ) : null}
            </>
          )}
        </div>

        {actions.length > 0 ? (
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional message to the candidate…"
              className="min-h-[64px]"
            />
            {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              {actions.map((kind) => (
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
          <p className="border-t border-white/[0.06] pt-4 text-[12px] text-white/40">
            This request is {request.status} — no further actions.
          </p>
        )}
      </div>
    </Dialog>
  );
}
