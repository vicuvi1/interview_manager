"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CalendarRange, Clock, ExternalLink, Inbox, ListChecks, MessageSquareText, Star } from "lucide-react";

import { CalendarInvite } from "@/components/calendar-invite";
import { WalletPayDialog } from "@/components/candidate/wallet-pay-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime, utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InterviewFeedback, InterviewRequest } from "@/lib/types";

const CANCELLABLE = new Set(["pending", "approved", "scheduled"]);
const RESCHEDULABLE = new Set(["approved", "scheduled"]);
// Once the admin accepts (approved/scheduled) or it's done, the candidate can pay —
// no invoice needed; they pay by crypto and report the amount.
const PAYABLE = new Set(["approved", "scheduled", "completed"]);

export function MyInterviewsCard({
  userId,
  timezone,
  initial,
}: {
  userId: string;
  timezone: string;
  initial: InterviewRequest[];
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<InterviewRequest[]>(initial);
  const [payTarget, setPayTarget] = useState<InterviewRequest | null>(null);
  const [reschedTarget, setReschedTarget] = useState<InterviewRequest | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, InterviewFeedback>>({});
  const [viewing, setViewing] = useState<InterviewFeedback | null>(null);
  const [todoDone, setTodoDone] = useState<number[]>([]);

  useEffect(() => {
    setTodoDone(viewing?.action_items_done ?? []);
  }, [viewing]);

  async function toggleTodo(i: number) {
    if (!viewing) return;
    const next = todoDone.includes(i) ? todoDone.filter((x) => x !== i) : [...todoDone, i];
    setTodoDone(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_todo_progress", { p_interview_id: viewing.interview_id, p_done: next });
    if (error) {
      toast({ title: "Couldn't save progress", description: error.message, variant: "error" });
      return;
    }
    setFeedbackMap((m) => ({
      ...m,
      [viewing.interview_id]: { ...m[viewing.interview_id], action_items_done: next },
    }));
  }

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { data: fb }] = await Promise.all([
      supabase
        .from("interview_requests")
        .select("*")
        .eq("candidate_id", userId)
        .order("created_at", { ascending: false }),
      // RLS returns only feedback that was shared with this candidate.
      supabase.from("interview_feedback").select("*"),
    ]);
    if (data) setRows(data as InterviewRequest[]);
    if (fb) setFeedbackMap(Object.fromEntries((fb as InterviewFeedback[]).map((f) => [f.interview_id, f])));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

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

  useDataChanged("interviews", load);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`interviews-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "interview_requests",
          filter: `candidate_id=eq.${userId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  return (
    <>
      <SectionCard
        title="My interviews"
        description="Your requests and their current status."
        icon={CalendarRange}
        bodyClassName="p-0 sm:p-0"
      >
      {rows.length === 0 ? (
        <div className="p-5 sm:p-6">
          <EmptyState
            icon={Inbox}
            title="No interviews yet"
            description="Submit a request and it will appear here instantly."
          />
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[12px] uppercase tracking-wide text-white/40">
                <th className="px-5 py-3 font-medium sm:px-6">Role</th>
                <th className="px-3 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">Duration</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Payment</th>
                <th className="px-5 py-3 font-medium sm:px-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-white/[0.03]">
                  <td className="px-5 py-3 font-medium text-[#f0f0f5] sm:px-6">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color ?? "rgba(255,255,255,0.18)" }}
                        aria-hidden
                      />
                      <Link href={`/candidate/interviews/${row.id}`} className="hover:text-white hover:underline">
                        {row.role}
                      </Link>
                    </span>
                    {row.last_edited_at ? (
                      <span className="mt-0.5 block text-[11px] text-white/35">Edited {relativeTime(row.last_edited_at)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-white/60">
                    {row.scheduled_at ? (
                      <div>
                        <span className="text-[#f0f0f5]">
                          {formatInTimeZone(row.scheduled_at, timezone)}
                        </span>
                        {row.meeting_link ? (
                          <span className="ml-2 inline-flex items-center gap-0.5 align-middle">
                            <a
                              href={row.meeting_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                            >
                              Join <ExternalLink className="h-3 w-3" />
                            </a>
                            <CopyButton value={row.meeting_link} title="Copy meeting link" className="h-6 w-6" />
                          </span>
                        ) : null}
                        <div className="mt-0.5">
                          <CalendarInvite
                            title={`Interview: ${row.role}`}
                            startISO={row.scheduled_at}
                            durationMin={row.duration_minutes || 30}
                            location={row.meeting_link}
                            details={`Your interview for "${row.role}".`}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-white/55">
                        {formatInTimeZone(row.preferred_at, timezone)}
                        <span className="ml-1 text-[12px] text-white/40">(preferred)</span>
                      </span>
                    )}
                    {row.status === "completed" && (row.recording_url || row.completion_notes || row.actual_minutes) ? (
                      <div className="mt-1.5 rounded-md bg-white/[0.03] px-2.5 py-2 text-[12px] text-white/50">
                        <span className="font-medium text-white/70">Meeting summary</span>
                        {row.actual_minutes ? <div className="mt-0.5">Lasted {row.actual_minutes} min</div> : null}
                        {row.recording_url ? (
                          <a
                            href={row.recording_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[#a5b4fc] hover:text-[#c7d2fe]"
                          >
                            Meeting link <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        {row.completion_notes ? (
                          <div className="mt-0.5 whitespace-pre-wrap text-white/55">{row.completion_notes}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-white/60">{row.duration_minutes} min</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-3">
                    {row.payment_status === "paid" ? (
                      <Badge tone="green">paid</Badge>
                    ) : PAYABLE.has(row.status) ? (
                      <Button size="sm" onClick={() => setPayTarget(row)}>
                        Pay
                      </Button>
                    ) : (
                      <span className="text-[13px] text-white/40">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 sm:px-6">
                    <div className="flex items-center justify-end gap-1.5">
                      {feedbackMap[row.id] ? (
                        <Button variant="secondary" size="sm" onClick={() => setViewing(feedbackMap[row.id])}>
                          <MessageSquareText className="h-4 w-4" /> Feedback
                        </Button>
                      ) : null}
                      {RESCHEDULABLE.has(row.status) ? (
                        row.proposed_at ? (
                          <Badge tone="amber">reschedule pending</Badge>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setReschedTarget(row)}>
                            <CalendarClock className="h-4 w-4" /> Reschedule
                          </Button>
                        )
                      ) : null}
                      {CANCELLABLE.has(row.status) ? (
                        <Button variant="ghost" size="sm" onClick={() => cancelRequest(row.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </SectionCard>
      {payTarget ? (
        <WalletPayDialog interviewId={payTarget.id} role={payTarget.role} onClose={() => setPayTarget(null)} />
      ) : null}
      {reschedTarget ? (
        <RescheduleDialog request={reschedTarget} timezone={timezone} onClose={() => setReschedTarget(null)} />
      ) : null}
      {viewing ? (
        <Dialog open onClose={() => setViewing(null)} title="Interview feedback" description="Shared by your interviewer.">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              {viewing.rating ? (
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={cn("h-5 w-5", n <= (viewing.rating ?? 0) ? "fill-[#fbbf24] text-[#fbbf24]" : "text-white/20")}
                    />
                  ))}
                </div>
              ) : <span />}
              {viewing.actual_minutes != null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] font-medium text-white/70">
                  <Clock className="h-3.5 w-3.5" /> {viewing.actual_minutes} min session
                </span>
              ) : null}
            </div>
            {viewing.shared_feedback ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">{viewing.shared_feedback}</p>
            ) : (
              <p className="text-[13px] text-white/50">No written feedback was shared.</p>
            )}
            {viewing.action_items ? (
              (() => {
                const items = viewing.action_items.split("\n").map((s) => s.trim()).filter(Boolean);
                const doneCount = items.filter((_, i) => todoDone.includes(i)).length;
                return (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/45">
                        <ListChecks className="h-3.5 w-3.5" /> Your to-do list
                      </p>
                      <span className="text-[12px] font-medium text-white/50">
                        {doneCount}/{items.length} done
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {items.map((item, i) => {
                        const done = todoDone.includes(i);
                        return (
                          <li key={i}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-white/[0.03]">
                              <input
                                type="checkbox"
                                checked={done}
                                onChange={() => toggleTodo(i)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-[#1a1a24] accent-[#34d399]"
                              />
                              <span className={cn("leading-snug", done ? "text-white/35 line-through" : "text-white/80")}>
                                {item}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-[11px] text-white/30">Your progress is shared with your interviewer.</p>
                  </div>
                );
              })()
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function RescheduleDialog({
  request,
  timezone,
  onClose,
}: {
  request: InterviewRequest;
  timezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!when) return setError("Pick a new date & time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const iso = wallTimeToUtcISO(when, timezone);
    // If the new time is genuinely inside published availability, rebook it
    // instantly; otherwise fall back to a proposal the admin confirms.
    const { data: booked } = await supabase.rpc("reschedule_to_open_slot", { p_interview_id: request.id, p_at: iso });
    if (booked === true) {
      setBusy(false);
      toast({ title: "Rescheduled", description: "Your new time is confirmed — it's on your calendar.", variant: "success" });
      notifyChanged("interviews");
      onClose();
      return;
    }
    const { error: rpcError } = await supabase.rpc("propose_reschedule", { p_interview_id: request.id, p_at: iso });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast({ title: "New time proposed", description: "That time isn't open — we've sent it to the admin to confirm.", variant: "success" });
    notifyChanged("interviews");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Reschedule" description={request.role}>
      <div className="space-y-4">
        <div className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[13px]">
          <p className="text-white/45">Currently scheduled</p>
          <p className="mt-0.5 font-medium text-[#f0f0f5]">
            {formatInTimeZone(request.scheduled_at ?? request.preferred_at, timezone)}
          </p>
        </div>
        <Field
          label="New time"
          htmlFor="resched-when"
          hint={`Times in ${timezone}. If it's an open slot you're rebooked instantly; otherwise the admin confirms.`}
        >
          <Input
            id="resched-when"
            type="datetime-local"
            min={utcToLocalInput(new Date().toISOString(), timezone)}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy || !when} onClick={submit}>
          <CalendarClock className="h-4 w-4" /> Reschedule
        </Button>
      </div>
    </Dialog>
  );
}
