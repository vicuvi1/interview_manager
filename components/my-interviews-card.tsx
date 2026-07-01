"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, ExternalLink, Inbox, MessageSquareText, Star } from "lucide-react";

import { WalletPayDialog } from "@/components/candidate/wallet-pay-dialog";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InterviewFeedback, InterviewRequest } from "@/lib/types";

const CANCELLABLE = new Set(["pending", "approved", "scheduled"]);

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
  const [feedbackMap, setFeedbackMap] = useState<Record<string, InterviewFeedback>>({});
  const [viewing, setViewing] = useState<InterviewFeedback | null>(null);

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
                      {row.role}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-white/60">
                    {row.scheduled_at ? (
                      <div>
                        <span className="text-[#f0f0f5]">
                          {formatInTimeZone(row.scheduled_at, timezone)}
                        </span>
                        {row.meeting_link ? (
                          <a
                            href={row.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                          >
                            Join <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-white/55">
                        {formatInTimeZone(row.preferred_at, timezone)}
                        <span className="ml-1 text-[12px] text-white/40">(preferred)</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-white/60">{row.duration_minutes} min</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTone[row.status] ?? "slate"}>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    {row.payment_status === "paid" ? (
                      <Badge tone="green">paid</Badge>
                    ) : row.price_cents ? (
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
      {viewing ? (
        <Dialog open onClose={() => setViewing(null)} title="Interview feedback" description="Shared by your interviewer.">
          <div className="space-y-4">
            {viewing.rating ? (
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn("h-5 w-5", n <= (viewing.rating ?? 0) ? "fill-[#fbbf24] text-[#fbbf24]" : "text-white/20")}
                  />
                ))}
              </div>
            ) : null}
            {viewing.shared_feedback ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">{viewing.shared_feedback}</p>
            ) : (
              <p className="text-[13px] text-white/50">No written feedback was shared.</p>
            )}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
