"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, CreditCard, Eye, EyeOff, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { cn, formatMoney, initials } from "@/lib/utils";
import type { CandidateLite, InterviewRequest, ProfileLite } from "@/lib/types";

export function PaymentsBoard({
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = (id: string) => candidates[id]?.full_name || candidates[id]?.email || "Candidate";

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*").not("price_cents", "is", null).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-payments-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);
  useDataChanged("interviews", load);

  const invoiced = useMemo(() => requests.filter((r) => r.price_cents != null), [requests]);
  const awaiting = useMemo(() => invoiced.filter((r) => r.payment_status !== "paid"), [invoiced]);
  const paid = useMemo(
    () => invoiced.filter((r) => r.payment_status === "paid").sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? "")),
    [invoiced],
  );
  const paidVisible = useMemo(() => paid.filter((r) => !r.payment_hidden), [paid]);
  const hiddenCount = paid.length - paidVisible.length;
  const paidList = showHidden ? paid : paidVisible;

  const kpis = useMemo(() => {
    const month = todayKeyInTimeZone(adminTimezone).slice(0, 7);
    let outstanding = 0, collectedMonth = 0;
    for (const r of awaiting) outstanding += r.price_cents ?? 0;
    for (const r of paid) {
      if (r.paid_at && dateKeyInTimeZone(r.paid_at, adminTimezone).slice(0, 7) === month) collectedMonth += r.price_cents ?? 0;
    }
    return { outstanding, collectedMonth };
  }, [awaiting, paid, adminTimezone]);

  async function markPaid(r: InterviewRequest) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "error" });
      setBusyId(null);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: r.candidate_id,
      title: "Payment received",
      detail: `We've recorded your payment of ${formatMoney(r.price_cents, r.currency)} for "${r.role}". Thank you!`,
      type: "success",
    });
    toast({ title: "Marked as paid", variant: "success" });
    setBusyId(null);
    load();
  }

  async function removeInvoice(r: InterviewRequest) {
    if (
      !window.confirm(
        `Remove the ${formatMoney(r.price_cents, r.currency)} invoice for "${r.role}"? This clears the payment record — the interview itself stays.`,
      )
    )
      return;
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ price_cents: null, payment_status: "unpaid", paid_at: null, payment_reported_at: null })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "error" });
      setBusyId(null);
      return;
    }
    toast({ title: "Invoice removed", variant: "success" });
    setBusyId(null);
    load();
  }

  async function hidePayment(r: InterviewRequest, hidden: boolean) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase.from("interview_requests").update({ payment_hidden: hidden }).eq("id", r.id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "error" });
      setBusyId(null);
      return;
    }
    toast({ title: hidden ? "Hidden from the board" : "Shown again", variant: "success" });
    setBusyId(null);
    load();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Payments</h1>
        <p className="text-[12px] text-white/40">Collections — who owes what, and what&apos;s been paid.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Outstanding" value={formatMoney(kpis.outstanding)} icon={Clock} tone={kpis.outstanding > 0 ? "amber" : "slate"} />
        <StatCard label="Collected this month" value={formatMoney(kpis.collectedMonth)} icon={Wallet} tone="green" />
        <StatCard label="Awaiting payment" value={awaiting.length} icon={CreditCard} tone="red" />
        <StatCard label="Paid invoices" value={paid.length} icon={CheckCircle2} tone="indigo" />
      </div>

      <SectionCard title="Awaiting payment" description="Invoiced but not yet paid." icon={CreditCard} bodyClassName="p-0 sm:p-0">
        {awaiting.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={CheckCircle2} title="Nothing outstanding" description="Every invoice is settled." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {awaiting.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <Row candidate={candidates[r.candidate_id]} name={candName(r.candidate_id)} candidateId={r.candidate_id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{candName(r.candidate_id)}</p>
                  <p className="text-[12px] text-white/45">
                    {r.role} · invoiced {relativeTime(r.created_at)}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-[#fbbf24]">
                  {formatMoney(r.price_cents, r.currency)}
                </span>
                <Button size="sm" loading={busyId === r.id} disabled={busyId !== null} onClick={() => markPaid(r)}>
                  Mark paid
                </Button>
                <button
                  type="button"
                  onClick={() => removeInvoice(r)}
                  disabled={busyId !== null}
                  className="shrink-0 rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-[#f87171] disabled:opacity-50"
                  aria-label="Remove invoice"
                  title="Remove invoice"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Recently paid"
        description="Settled invoices."
        icon={CheckCircle2}
        bodyClassName="p-0 sm:p-0"
        action={
          hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/50 transition-colors hover:text-white/80"
            >
              {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </button>
          ) : undefined
        }
      >
        {paidList.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Wallet} title={paid.length === 0 ? "No payments yet" : "All tidy"} description={paid.length === 0 ? undefined : "Everything paid is hidden."} />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {paidList.slice(0, 20).map((r) => (
              <li key={r.id} className={cn("flex items-center gap-3 px-5 py-3.5 sm:px-6", r.payment_hidden && "opacity-55")}>
                <Row candidate={candidates[r.candidate_id]} name={candName(r.candidate_id)} candidateId={r.candidate_id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{candName(r.candidate_id)}</p>
                  <p className="text-[12px] text-white/45">
                    {r.role} · {r.paid_at ? formatInTimeZone(r.paid_at, adminTimezone) : "—"}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-[#34d399]">
                  {formatMoney(r.price_cents, r.currency)}
                </span>
                {r.payment_hidden ? <Badge tone="slate">hidden</Badge> : <Badge tone="green">paid</Badge>}
                <button
                  type="button"
                  onClick={() => hidePayment(r, !r.payment_hidden)}
                  disabled={busyId !== null}
                  className="shrink-0 rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-50"
                  aria-label={r.payment_hidden ? "Show on board" : "Hide from board"}
                  title={r.payment_hidden ? "Show on board" : "Hide from board"}
                >
                  {r.payment_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="px-1 text-[12px] text-white/35">
        Looking for analytics and the full ledger?{" "}
        <Link href="/admin/revenue" className="font-medium text-[#a5b4fc] hover:text-[#c7d2fe]">
          Open Revenue →
        </Link>
      </p>
    </div>
  );
}

function Row({ candidate, name, candidateId }: { candidate?: CandidateLite; name: string; candidateId: string }) {
  return (
    <Link href={`/admin/candidates/${candidateId}`} className="shrink-0" aria-label={name}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
        {initials(candidate?.full_name, candidate?.email)}
      </span>
    </Link>
  );
}
