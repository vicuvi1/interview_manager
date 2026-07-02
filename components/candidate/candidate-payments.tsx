"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, Clock, Inbox, Wallet } from "lucide-react";

import { WalletPayDialog } from "@/components/candidate/wallet-pay-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import type { InterviewRequest } from "@/lib/types";

// Payable once the admin has accepted (approved/scheduled) or it's completed.
const ACTIVE = new Set(["approved", "scheduled", "completed"]);

export function CandidatePayments({
  userId,
  timezone,
  initial,
}: {
  userId: string;
  timezone: string;
  initial: InterviewRequest[];
}) {
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

  useEffect(() => {
    load();
  }, [load]);
  useDataChanged("interviews", load);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`cand-pay-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interview_requests", filter: `candidate_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const { unpaid, dueCents } = useMemo(() => {
    const active = rows.filter((r) => ACTIVE.has(r.status));
    const unpaid = active.filter((r) => r.payment_status !== "paid");
    const dueCents = unpaid.reduce((sum, r) => sum + (r.price_cents ?? 0), 0);
    return { unpaid, dueCents };
  }, [rows]);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4">
        <StatCard label="To pay" value={unpaid.length} icon={Clock} tone="amber" />
        <StatCard label="Amount due" value={dueCents ? formatMoney(dueCents, "USD") : "—"} icon={BadgeDollarSign} tone="indigo" />
      </div>

      <SectionCard
        title="Payments due"
        description="Interviews you haven't paid for yet. Pay by crypto and pick your wallet."
        icon={Wallet}
        bodyClassName="p-0 sm:p-0"
      >
        {unpaid.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Inbox} title="You're all settled" description="No outstanding payments right now." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {unpaid.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: r.color ?? "rgba(255,255,255,0.18)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#f0f0f5]">{r.role}</p>
                  <p className="text-[12px] text-white/45">
                    {formatInTimeZone(r.scheduled_at ?? r.preferred_at, timezone)}
                    {r.interview_type ? ` · ${r.interview_type}` : ""}
                  </p>
                </div>
                {r.price_cents ? (
                  <span className="tabular-nums text-[14px] font-semibold text-white/85">
                    {formatMoney(r.price_cents, r.currency)}
                  </span>
                ) : (
                  <Badge tone="slate">amount open</Badge>
                )}
                <Button size="sm" onClick={() => setPayTarget(r)}>
                  <Wallet className="h-4 w-4" /> Pay now
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {payTarget ? (
        <WalletPayDialog interviewId={payTarget.id} role={payTarget.role} onClose={() => setPayTarget(null)} />
      ) : null}
    </>
  );
}
