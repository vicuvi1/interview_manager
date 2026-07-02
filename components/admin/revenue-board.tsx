"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Clock,
  Plus,
  Printer,
  Trophy,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { MONTH_NAMES, dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { METHOD_LABEL, PAYMENT_METHODS, PAYMENT_STATUS_TONE, formatAmount } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { useDebouncedCallback } from "@/lib/use-debounced";
import { formatInTimeZone } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import type { CandidateLite, Payment, ProfileLite } from "@/lib/types";

const amt = (p: Payment) => Number(p.amount) || 0;
const isPaid = (s: string) => s === "paid";
const isOutstanding = (s: string) => s === "pending" || s === "overdue" || s === "partial";

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function RevenueBoard({
  adminTimezone,
  initialPayments,
  initialProfiles,
}: {
  adminTimezone: string;
  initialPayments: Payment[];
  initialProfiles: ProfileLite[];
}) {
  const { toast } = useToast();
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialProfiles);
  const [markTarget, setMarkTarget] = useState<Payment | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "paid", dir: -1 });

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = (id: string) => candidates[id]?.full_name || candidates[id]?.email || "Unknown";

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: pays }, { data: profs }] = await Promise.all([
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
    ]);
    if (pays) setPayments(pays as Payment[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  const reload = useDebouncedCallback(load);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-revenue")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  const monthKey = todayKeyInTimeZone(adminTimezone).slice(0, 7);
  const lastMonthKey = prevMonth(monthKey);

  const kpis = useMemo(() => {
    let total = 0, thisM = 0, lastM = 0, outstanding = 0;
    for (const p of payments) {
      if (isPaid(p.status)) {
        total += amt(p);
        const mk = p.paid_at ? dateKeyInTimeZone(p.paid_at, adminTimezone).slice(0, 7) : "";
        if (mk === monthKey) thisM += amt(p);
        else if (mk === lastMonthKey) lastM += amt(p);
      } else if (isOutstanding(p.status)) {
        outstanding += amt(p);
      }
    }
    return { total, thisM, lastM, outstanding };
  }, [payments, adminTimezone, monthKey, lastMonthKey]);

  const leaderboard = useMemo(() => {
    const map = new Map<string, { id: string; interviews: number; paid: number; pending: number; last: string | null; overdue: boolean }>();
    for (const p of payments) {
      const row = map.get(p.candidate_id) ?? { id: p.candidate_id, interviews: 0, paid: 0, pending: 0, last: null, overdue: false };
      if (p.interview_id) row.interviews += 1;
      if (isPaid(p.status)) {
        row.paid += amt(p);
        if (p.paid_at && (!row.last || p.paid_at > row.last)) row.last = p.paid_at;
      } else if (isOutstanding(p.status)) {
        row.pending += amt(p);
        if (p.status === "overdue") row.overdue = true;
      }
      map.set(p.candidate_id, row);
    }
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case "name":
          return dir * candName(a.id).localeCompare(candName(b.id));
        case "interviews":
          return dir * (a.interviews - b.interviews);
        case "pending":
          return dir * (a.pending - b.pending);
        case "last":
          return dir * ((a.last ?? "").localeCompare(b.last ?? ""));
        default:
          return dir * (a.paid - b.paid);
      }
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, sort, candidates]);

  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      if (!isPaid(p.status)) continue;
      const key = p.method ?? "unspecified";
      map.set(key, (map.get(key) ?? 0) + amt(p));
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ method: k, total: v }))
      .sort((a, b) => b.total - a.total);
  }, [payments]);

  const monthly = useMemo(() => {
    const months: string[] = [];
    let mk = monthKey;
    for (let i = 0; i < 6; i++) {
      months.unshift(mk);
      mk = prevMonth(mk);
    }
    const totals = months.map((m) => {
      let t = 0;
      for (const p of payments) {
        if (isPaid(p.status) && p.paid_at && dateKeyInTimeZone(p.paid_at, adminTimezone).slice(0, 7) === m) t += amt(p);
      }
      const [y, mm] = m.split("-").map(Number);
      return { label: MONTH_NAMES[mm - 1].slice(0, 3), year: y, total: t };
    });
    return totals;
  }, [payments, monthKey, adminTimezone]);

  async function setStatus(p: Payment, status: string, extra: Partial<Payment> = {}) {
    setBusyId(p.id);
    const supabase = createClient();
    const { error } = await supabase.from("payments").update({ status, updated_at: new Date().toISOString(), ...extra }).eq("id", p.id);
    if (error) toast({ title: "Couldn't update", description: error.message, variant: "error" });
    else {
      toast({ title: status === "overdue" ? "Marked overdue" : "Payment updated", variant: "success" });
      if (status === "overdue") {
        await supabase.from("notifications").insert({
          user_id: p.candidate_id,
          title: "Payment overdue",
          detail: `Your payment of ${formatAmount(amt(p), p.currency)} is overdue.`,
          type: "alert",
        });
      }
      load();
    }
    setBusyId(null);
  }

  function receipt(p: Payment) {
    const w = window.open("", "_blank", "width=460,height=640");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Receipt ${p.id.slice(0, 8)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:32px;color:#0f172a} h1{font-size:18px} .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px} .k{color:#64748b} .amt{font-size:28px;font-weight:700;margin:16px 0}</style>
      </head><body>
      <h1>Payment receipt</h1>
      <div class="amt">${formatAmount(amt(p), p.currency)}</div>
      <div class="row"><span class="k">Candidate</span><span>${candName(p.candidate_id)}</span></div>
      <div class="row"><span class="k">Method</span><span>${p.method ? METHOD_LABEL[p.method] ?? p.method : "—"}</span></div>
      <div class="row"><span class="k">Status</span><span>${p.status}</span></div>
      <div class="row"><span class="k">Date</span><span>${p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</span></div>
      <div class="row"><span class="k">Reference</span><span>${p.id}</span></div>
      ${p.notes ? `<div class="row"><span class="k">Notes</span><span>${p.notes}</span></div>` : ""}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const methodMax = Math.max(1, ...byMethod.map((m) => m.total));
  const monthMax = Math.max(1, ...monthly.map((m) => m.total));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Revenue</h1>
          <p className="text-[12px] text-white/40">Payments, leaderboard, and trends.</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add payment
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total revenue" value={formatAmount(kpis.total)} icon={Wallet} tone="green" />
        <StatCard label="This month" value={formatAmount(kpis.thisM)} icon={Wallet} tone="indigo" />
        <StatCard label="Last month" value={formatAmount(kpis.lastM)} icon={Wallet} tone="slate" />
        <StatCard label="Outstanding" value={formatAmount(kpis.outstanding)} icon={Clock} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Revenue by method" description="Paid, by payment method." icon={Wallet}>
          {byMethod.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments yet" />
          ) : (
            <div className="space-y-2.5">
              {byMethod.map((m) => (
                <div key={m.method} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[12px] text-white/55">
                    {m.method === "unspecified" ? "Other" : METHOD_LABEL[m.method] ?? m.method}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
                      style={{ width: `${(m.total / methodMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-white/80">
                    {formatAmount(m.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Monthly trend" description="Paid revenue, last 6 months." icon={Wallet}>
          <div className="flex h-40 items-end gap-2">
            {monthly.map((m) => (
              <div key={`${m.year}-${m.label}`} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-[#6366f1] to-[#8b5cf6]"
                    style={{ height: `${Math.max(2, (m.total / monthMax) * 100)}%` }}
                    title={formatAmount(m.total)}
                  />
                </div>
                <span className="text-[10px] text-white/40">{m.label}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Candidate leaderboard" description="Top candidates by revenue." icon={Trophy} bodyClassName="p-0 sm:p-0">
        {leaderboard.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Trophy} title="No candidates yet" />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                  <th className="px-5 py-2.5 font-medium sm:px-6">#</th>
                  <SortTh label="Candidate" k="name" sort={sort} setSort={setSort} />
                  <SortTh label="Interviews" k="interviews" sort={sort} setSort={setSort} />
                  <SortTh label="Total paid" k="paid" sort={sort} setSort={setSort} />
                  <SortTh label="Pending" k="pending" sort={sort} setSort={setSort} />
                  <SortTh label="Last payment" k="last" sort={sort} setSort={setSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {leaderboard.map((row, i) => (
                  <tr key={row.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3 text-white/40 sm:px-6">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
                          {initials(candidates[row.id]?.full_name, candidates[row.id]?.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#f0f0f5]">{candName(row.id)}</p>
                          {row.overdue ? <Badge tone="red">overdue</Badge> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-white/80">{row.interviews}</td>
                    <td className="px-3 py-3 tabular-nums font-medium text-[#34d399]">{formatAmount(row.paid)}</td>
                    <td className="px-3 py-3 tabular-nums text-[#fbbf24]">{formatAmount(row.pending)}</td>
                    <td className="px-3 py-3 text-white/55">
                      {row.last ? formatInTimeZone(row.last, adminTimezone) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="All payments" description="The full ledger." icon={Wallet} bodyClassName="p-0 sm:p-0">
        {payments.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Wallet} title="No payments yet" description="Add a payment or invoice a request." />
          </div>
        ) : (
          <div className="max-h-[440px] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="sticky top-0 bg-[#13131a]">
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                  <th className="px-5 py-2.5 font-medium sm:px-6">Candidate</th>
                  <th className="px-3 py-2.5 font-medium">Amount</th>
                  <th className="px-3 py-2.5 font-medium">Method</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium sm:px-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {payments.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3 text-[#f0f0f5] sm:px-6">{candName(p.candidate_id)}</td>
                    <td className="px-3 py-3 tabular-nums text-white/80">{formatAmount(amt(p), p.currency)}</td>
                    <td className="px-3 py-3 text-white/60">{p.method ? METHOD_LABEL[p.method] ?? p.method : "—"}</td>
                    <td className="px-3 py-3">
                      <Badge tone={PAYMENT_STATUS_TONE[p.status] ?? "slate"}>{p.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {p.paid_at ? formatInTimeZone(p.paid_at, adminTimezone) : "—"}
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isPaid(p.status) ? (
                          <>
                            <Button size="sm" onClick={() => setMarkTarget(p)}>
                              Mark paid
                            </Button>
                            {p.status !== "overdue" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={busyId === p.id}
                                disabled={busyId !== null}
                                onClick={() => setStatus(p, "overdue")}
                              >
                                Overdue
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => receipt(p)}
                          className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                          aria-label="Receipt"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {markTarget ? (
        <MarkPaidDialog
          payment={markTarget}
          candidateName={candName(markTarget.candidate_id)}
          onClose={() => setMarkTarget(null)}
          onDone={load}
        />
      ) : null}
      {addOpen ? (
        <AddPaymentDialog profiles={profiles} onClose={() => setAddOpen(false)} onDone={load} />
      ) : null}
    </div>
  );
}

function SortTh({
  label,
  k,
  sort,
  setSort,
}: {
  label: string;
  k: string;
  sort: { key: string; dir: 1 | -1 };
  setSort: (s: { key: string; dir: 1 | -1 }) => void;
}) {
  return (
    <th className="px-3 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: sort.key === k && sort.dir === -1 ? 1 : -1 })}
        className={cn(
          "inline-flex items-center gap-1 hover:text-white/70",
          sort.key === k && "text-white/80",
        )}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function MarkPaidDialog({
  payment,
  candidateName,
  onClose,
  onDone,
}: {
  payment: Payment;
  candidateName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [method, setMethod] = useState(payment.method ?? "bank_transfer");
  const [note, setNote] = useState(payment.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("payments")
      .update({ status: "paid", method, notes: note.trim() || null, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", payment.id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "error" });
      setBusy(false);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: payment.candidate_id,
      title: "Payment confirmed",
      detail: `Your payment of ${formatAmount(Number(payment.amount), payment.currency)} was received. Thank you!`,
      type: "success",
    });
    toast({ title: "Marked as paid", variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Mark as paid" description={candidateName}>
      <div className="space-y-4">
        <div className="rounded-lg bg-white/[0.03] px-4 py-3 text-[13px]">
          <span className="text-white/55">Amount</span>
          <span className="ml-2 text-lg font-semibold text-[#f0f0f5]">
            {formatAmount(Number(payment.amount), payment.currency)}
          </span>
        </div>
        <Field label="Method" htmlFor="method">
          <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" htmlFor="note" hint="Optional — e.g. transaction hash.">
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button className="w-full" loading={busy} onClick={confirm}>
          Confirm payment
        </Button>
      </div>
    </Dialog>
  );
}

function AddPaymentDialog({
  profiles,
  onClose,
  onDone,
}: {
  profiles: ProfileLite[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const candidatesList = useMemo(() => profiles.filter((p) => p.role !== "admin"), [profiles]);
  const [candidateId, setCandidateId] = useState(candidatesList[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = parseFloat(amount);
    if (!candidateId) {
      setError("Select a candidate.");
      return;
    }
    if (!value || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const paidAt = date ? new Date(date).toISOString() : new Date().toISOString();
    const { error: insertError } = await supabase.from("payments").insert({
      candidate_id: candidateId,
      amount: value,
      currency: "USD",
      method,
      status: "paid",
      paid_at: paidAt,
      notes: notes.trim() || null,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    toast({ title: "Payment recorded", variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Add payment" description="Record a payment manually.">
      <div className="space-y-4">
        <Field label="Candidate" htmlFor="cand">
          <Select id="cand" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
            {candidatesList.length === 0 ? <option value="">No candidates</option> : null}
            {candidatesList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (USD)" htmlFor="amt">
            <Input id="amt" inputMode="decimal" placeholder="150.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="date">
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Method" htmlFor="m">
          <Select id="m" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="n">
          <Textarea id="n" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={save}>
          Record payment
        </Button>
      </div>
    </Dialog>
  );
}
