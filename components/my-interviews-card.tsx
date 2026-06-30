"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, ExternalLink, Inbox } from "lucide-react";

import { CheckoutDialog } from "@/components/checkout-dialog";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import type { InterviewRequest } from "@/lib/types";

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

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", userId)
      .order("created_at", { ascending: false });
    if (data) setRows(data as InterviewRequest[]);
  }, [userId]);

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
              <tr className="border-b border-slate-100 text-[12px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium sm:px-6">Role</th>
                <th className="px-3 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">Duration</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Payment</th>
                <th className="px-5 py-3 font-medium sm:px-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-800 sm:px-6">{row.role}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {row.scheduled_at ? (
                      <div>
                        <span className="text-slate-800">
                          {formatInTimeZone(row.scheduled_at, timezone)}
                        </span>
                        {row.meeting_link ? (
                          <a
                            href={row.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:text-brand-700"
                          >
                            Join <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">
                        {formatInTimeZone(row.preferred_at, timezone)}
                        <span className="ml-1 text-[12px] text-slate-400">(preferred)</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.duration_minutes} min</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTone[row.status] ?? "slate"}>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    {row.payment_status === "paid" ? (
                      <Badge tone="green">paid</Badge>
                    ) : row.price_cents ? (
                      <Button size="sm" onClick={() => setPayTarget(row)}>
                        Pay {formatMoney(row.price_cents, row.currency)}
                      </Button>
                    ) : (
                      <span className="text-[13px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right sm:px-6">
                    {CANCELLABLE.has(row.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelRequest(row.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </SectionCard>
      <CheckoutDialog
        interview={payTarget}
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
      />
    </>
  );
}
