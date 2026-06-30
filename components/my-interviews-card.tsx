"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Inbox } from "lucide-react";

import { Badge, paymentTone, statusTone } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import type { InterviewRequest } from "@/lib/types";

export function MyInterviewsCard({
  userId,
  timezone,
  initial,
}: {
  userId: string;
  timezone: string;
  initial: InterviewRequest[];
}) {
  const [rows, setRows] = useState<InterviewRequest[]>(initial);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", userId)
      .order("created_at", { ascending: false });
    if (data) setRows(data as InterviewRequest[]);
  }, [userId]);

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
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[12px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium sm:px-6">Role</th>
                <th className="px-3 py-3 font-medium">Preferred</th>
                <th className="px-3 py-3 font-medium">Duration</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium sm:px-6">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-800 sm:px-6">{row.role}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {formatInTimeZone(row.preferred_at, timezone)}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.duration_minutes} min</td>
                  <td className="px-3 py-3">
                    <Badge tone={statusTone[row.status] ?? "slate"}>{row.status}</Badge>
                  </td>
                  <td className="px-5 py-3 sm:px-6">
                    <Badge tone={paymentTone[row.payment_status] ?? "slate"}>
                      {row.payment_status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
