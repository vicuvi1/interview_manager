"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  Ban,
  CalendarClock,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Github,
  Globe,
  KeyRound,
  Linkedin,
  Link2,
  MessageSquarePlus,
  Pencil,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  StickyNote,
  Tags,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import { FeedbackDialog } from "@/components/admin/feedback-dialog";
import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { StageTracker } from "@/components/admin/stage-tracker";
import { StatCard } from "@/components/admin/stat-card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { useDebouncedCallback } from "@/lib/use-debounced";
import { OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/feedback";
import { METHOD_LABEL, PAYMENT_METHODS, PAYMENT_STATUS_TONE, formatAmount } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { initials } from "@/lib/utils";
import type {
  CandidateLite,
  CandidateMaterials,
  CandidateNote,
  InterviewFeedback,
  InterviewRequest,
  Payment,
  ProfileLite,
} from "@/lib/types";

const isOutstanding = (s: string) => s === "pending" || s === "overdue" || s === "partial";

export function CandidateDetail({
  candidate,
  materials,
  adminId,
  adminTimezone,
  initialRequests,
  initialPayments,
  initialNotes,
  initialFeedback = [],
}: {
  candidate: ProfileLite;
  materials?: CandidateMaterials;
  adminId: string;
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialPayments: Payment[];
  initialNotes: CandidateNote[];
  initialFeedback?: InterviewFeedback[];
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [notes, setNotes] = useState<CandidateNote[]>(initialNotes);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, InterviewFeedback>>(() =>
    Object.fromEntries(initialFeedback.map((f) => [f.interview_id, f])),
  );

  const [feedbackReq, setFeedbackReq] = useState<InterviewRequest | null>(null);
  const [manageRequest, setManageRequest] = useState<InterviewRequest | null>(null);
  const [addPayOpen, setAddPayOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [busyPayId, setBusyPayId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<boolean>(!!candidate.blocked);
  const [blocking, setBlocking] = useState(false);
  const [accountBusy, setAccountBusy] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ password: string; email: string | null } | null>(null);
  const [fullName, setFullName] = useState<string | null>(candidate.full_name);
  const [renameOpen, setRenameOpen] = useState(false);
  const router = useRouter();

  const name = fullName || candidate.email || "Candidate";
  const candidatesMap = useMemo<Record<string, CandidateLite>>(
    () => ({ [candidate.id]: { full_name: fullName, email: candidate.email, timezone: candidate.timezone } }),
    [candidate, fullName],
  );

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: pays }, { data: n }] = await Promise.all([
      supabase.from("interview_requests").select("*").eq("candidate_id", candidate.id).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").eq("candidate_id", candidate.id).order("created_at", { ascending: false }),
      supabase.from("candidate_notes").select("*").eq("candidate_id", candidate.id).order("created_at", { ascending: false }),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (pays) setPayments(pays as Payment[]);
    if (n) setNotes(n as CandidateNote[]);

    const reqIds = ((reqs as InterviewRequest[] | null) ?? []).map((r) => r.id);
    if (reqIds.length) {
      const { data: fb } = await supabase.from("interview_feedback").select("*").in("interview_id", reqIds);
      if (fb) setFeedbackMap(Object.fromEntries((fb as InterviewFeedback[]).map((f) => [f.interview_id, f])));
    } else {
      setFeedbackMap({});
    }
  }, [candidate.id]);

  const reload = useDebouncedCallback(load);
  useEffect(() => {
    const supabase = createClient();
    const filter = `candidate_id=eq.${candidate.id}`;
    const channel = supabase
      .channel(`candidate-${candidate.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests", filter }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidate_notes", filter }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [candidate.id, reload]);
  useDataChanged("interviews", load);

  const kpis = useMemo(() => {
    const now = Date.now();
    let completed = 0, upcoming = 0, paid = 0, outstanding = 0;
    for (const r of requests) {
      if (r.status === "completed") completed += 1;
      if (r.status === "scheduled" && r.scheduled_at && new Date(r.scheduled_at).getTime() >= now) upcoming += 1;
    }
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      if (p.status === "paid") paid += amount;
      else if (isOutstanding(p.status)) outstanding += amount;
    }
    return { total: requests.length, completed, upcoming, paid, outstanding };
  }, [requests, payments]);

  const timeline = useMemo(() => {
    const items: { at: string; icon: typeof Clock; text: string; tone: string }[] = [];
    for (const r of requests) {
      items.push({ at: r.created_at, icon: MessageSquarePlus, tone: "text-white/40", text: `Requested "${r.role}"` });
      if (r.scheduled_at) items.push({ at: r.scheduled_at, icon: CalendarClock, tone: "text-[#a5b4fc]", text: `Interview for "${r.role}" scheduled` });
      if (r.status === "completed") items.push({ at: r.scheduled_at ?? r.created_at, icon: CheckCircle2, tone: "text-[#34d399]", text: `"${r.role}" marked completed` });
    }
    for (const p of payments) {
      if (p.status === "paid" && p.paid_at) items.push({ at: p.paid_at, icon: Wallet, tone: "text-[#34d399]", text: `Paid ${formatAmount(Number(p.amount), p.currency)}` });
      else items.push({ at: p.created_at, icon: BadgeDollarSign, tone: "text-[#fbbf24]", text: `Invoice ${formatAmount(Number(p.amount), p.currency)} · ${p.status}` });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);
  }, [requests, payments]);

  async function markPaid(p: Payment) {
    setBusyPayId(p.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("payments")
      .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) toast({ title: "Couldn't update", description: error.message, variant: "error" });
    else {
      toast({ title: "Marked as paid", variant: "success" });
      load();
    }
    setBusyPayId(null);
  }

  async function addNote() {
    const body = noteBody.trim();
    if (!body) return;
    setSavingNote(true);
    const supabase = createClient();
    const { error } = await supabase.from("candidate_notes").insert({ candidate_id: candidate.id, body, created_by: adminId });
    if (error) toast({ title: "Couldn't save note", description: error.message, variant: "error" });
    else {
      setNoteBody("");
      load();
    }
    setSavingNote(false);
  }

  async function deleteNote(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("candidate_notes").delete().eq("id", id);
    if (error) toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    else load();
  }

  async function toggleBlocked() {
    const next = !blocked;
    if (next && !window.confirm(`Block ${name}? They won't be able to sign in or book.`)) return;
    setBlocking(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_user_blocked", { p_user: candidate.id, p_blocked: next });
    if (error) {
      toast({ title: "Couldn't update access", description: error.message, variant: "error" });
    } else {
      setBlocked(next);
      toast({ title: next ? "Candidate blocked" : "Candidate unblocked", variant: next ? "info" : "success" });
    }
    setBlocking(false);
  }

  async function resetPassword() {
    setAccountBusy("reset");
    const res = await fetch("/api/admin/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password", userId: candidate.id }),
    });
    const r = await res.json();
    setAccountBusy(null);
    if (r.error) return toast({ title: "Couldn't reset password", description: r.error, variant: "error" });
    setResetResult({ password: r.password, email: r.email });
  }

  async function deleteAccount() {
    if (!window.confirm(`Permanently delete ${name} and all their data? This cannot be undone.`)) return;
    setAccountBusy("delete");
    const res = await fetch("/api/admin/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", userId: candidate.id }),
    });
    const r = await res.json();
    setAccountBusy(null);
    if (r.error) return toast({ title: "Couldn't delete", description: r.error, variant: "error" });
    toast({ title: "Account deleted", variant: "success" });
    router.push("/admin/candidates");
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/candidates" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white/80">
        <ArrowLeft className="h-4 w-4" /> All candidates
      </Link>

      {/* Header */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-lg font-semibold text-white">
            {initials(candidate.full_name, candidate.email)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-medium text-[#f0f0f5]">{name}</h1>
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                title="Rename this user"
                className="shrink-0 rounded-md p-1 text-white/35 transition hover:bg-white/[0.06] hover:text-white/80"
                aria-label="Rename user"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <Badge tone={candidate.role === "admin" ? "purple" : "slate"}>{candidate.role}</Badge>
              {blocked ? <Badge tone="red">suspended</Badge> : null}
            </div>
            <p className="flex items-center gap-1 truncate text-[13px] text-white/55">
              {candidate.email}
              <CopyButton value={candidate.email ?? undefined} title="Copy email" className="h-6 w-6" />
            </p>
            <p className="mt-0.5 text-[12px] text-white/35">
              {candidate.timezone} · joined {relativeTime(candidate.created_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setNotifyOpen(true)}>
            <Send className="h-4 w-4" /> Notify
          </Button>
          <Button size="sm" onClick={() => setAddPayOpen(true)}>
            <Plus className="h-4 w-4" /> Add payment
          </Button>
          {candidate.role !== "admin" ? (
            <>
              <Button size="sm" variant="secondary" loading={accountBusy === "reset"} disabled={accountBusy !== null} onClick={resetPassword}>
                <KeyRound className="h-4 w-4" /> Reset password
              </Button>
              <Button
                size="sm"
                variant={blocked ? "secondary" : "danger"}
                loading={blocking}
                disabled={blocking}
                onClick={toggleBlocked}
              >
                {blocked ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                {blocked ? "Unblock" : "Block"}
              </Button>
              <Button size="sm" variant="ghost" loading={accountBusy === "delete"} disabled={accountBusy !== null} onClick={deleteAccount}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {/* Pipeline stage */}
      <StageTracker candidateId={candidate.id} initialStage={candidate.stage ?? "applied"} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Interviews" value={kpis.total} icon={CalendarCheck} tone="indigo" />
        <StatCard label="Completed" value={kpis.completed} icon={CheckCircle2} tone="green" />
        <StatCard label="Upcoming" value={kpis.upcoming} icon={CalendarClock} tone="blue" />
        <StatCard label="Total paid" value={formatAmount(kpis.paid)} icon={Wallet} tone="green" />
        <StatCard label="Outstanding" value={formatAmount(kpis.outstanding)} icon={Clock} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Interview history */}
          <SectionCard title="Interview history" description="Every request from this candidate." icon={CalendarCheck} bodyClassName="p-0 sm:p-0">
            {requests.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={CalendarCheck} title="No interviews yet" />
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                      <th className="px-5 py-2.5 font-medium sm:px-6">Role</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">When</th>
                      <th className="px-3 py-2.5 font-medium">Payment</th>
                      <th className="px-5 py-2.5 font-medium sm:px-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {requests.map((r) => (
                      <tr key={r.id} className="transition-colors hover:bg-white/[0.03]">
                        <td className="px-5 py-3 font-medium text-[#f0f0f5] sm:px-6">{r.role}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
                            {feedbackMap[r.id] ? (
                              <Badge tone={OUTCOME_TONE[feedbackMap[r.id].outcome] ?? "slate"}>
                                {OUTCOME_LABEL[feedbackMap[r.id].outcome] ?? feedbackMap[r.id].outcome}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-white/60">
                          {formatInTimeZone(r.scheduled_at ?? r.preferred_at, adminTimezone)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={r.payment_status === "paid" ? "green" : "amber"}>{r.payment_status}</Badge>
                        </td>
                        <td className="px-5 py-3 sm:px-6">
                          <div className="flex items-center justify-end gap-1.5">
                            {r.status === "scheduled" || r.status === "completed" ? (
                              <Button size="sm" variant="secondary" onClick={() => setFeedbackReq(r)}>
                                Feedback
                              </Button>
                            ) : null}
                            <Button size="sm" variant="secondary" onClick={() => setManageRequest(r)}>
                              Manage
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Payments */}
          <SectionCard
            title="Payments"
            description="This candidate's ledger."
            icon={Wallet}
            bodyClassName="p-0 sm:p-0"
            action={
              <Button size="sm" variant="secondary" onClick={() => setAddPayOpen(true)}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            }
          >
            {payments.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState icon={Wallet} title="No payments yet" />
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                      <th className="px-5 py-2.5 font-medium sm:px-6">Amount</th>
                      <th className="px-3 py-2.5 font-medium">Method</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Date</th>
                      <th className="px-5 py-2.5 font-medium sm:px-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {payments.map((p) => (
                      <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                        <td className="px-5 py-3 tabular-nums font-medium text-white/80 sm:px-6">
                          {formatAmount(Number(p.amount), p.currency)}
                        </td>
                        <td className="px-3 py-3 text-white/60">{p.method ? METHOD_LABEL[p.method] ?? p.method : "—"}</td>
                        <td className="px-3 py-3">
                          <Badge tone={PAYMENT_STATUS_TONE[p.status] ?? "slate"}>{p.status}</Badge>
                        </td>
                        <td className="px-3 py-3 text-white/55">
                          {p.paid_at ? formatInTimeZone(p.paid_at, adminTimezone) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right sm:px-6">
                          {p.status !== "paid" ? (
                            <Button size="sm" loading={busyPayId === p.id} disabled={busyPayId !== null} onClick={() => markPaid(p)}>
                              Mark paid
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
        </div>

        {/* Right rail: tags + links + notes + timeline */}
        <div className="space-y-5">
          <TagsCard candidateId={candidate.id} initial={candidate.tags ?? []} />

          <MaterialsCard materials={materials} candidateId={candidate.id} />

          <SectionCard title="Private notes" description="Only admins can see these." icon={StickyNote}>
            <div className="space-y-3">
              <Textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add a note about this candidate…"
                className="min-h-[72px]"
              />
              <div className="flex justify-end">
                <Button size="sm" loading={savingNote} disabled={!noteBody.trim()} onClick={addNote}>
                  <MessageSquarePlus className="h-4 w-4" /> Add note
                </Button>
              </div>
              {notes.length === 0 ? (
                <p className="py-2 text-center text-[12px] text-white/30">No notes yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {notes.map((n) => (
                    <li key={n.id} className="group rounded-lg bg-white/[0.03] px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-[13px] text-white/80">{n.body}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-white/30">{relativeTime(n.created_at)}</span>
                        <button
                          type="button"
                          onClick={() => deleteNote(n.id)}
                          className="text-white/25 opacity-0 transition hover:text-[#f87171] group-hover:opacity-100"
                          aria-label="Delete note"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Activity" description="Recent timeline." icon={Clock}>
            {timeline.length === 0 ? (
              <EmptyState icon={Clock} title="No activity yet" />
            ) : (
              <ul className="space-y-3">
                {timeline.map((t, i) => {
                  const Icon = t.icon;
                  return (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                        <Icon className={`h-3.5 w-3.5 ${t.tone}`} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] text-white/75">{t.text}</p>
                        <p className="text-[11px] text-white/30">{relativeTime(t.at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {manageRequest ? (
        <ManageRequestDialog
          request={manageRequest}
          candidates={candidatesMap}
          adminTimezone={adminTimezone}
          requests={requests}
          onClose={() => setManageRequest(null)}
        />
      ) : null}
      {addPayOpen ? (
        <AddPaymentDialog candidateId={candidate.id} candidateName={name} onClose={() => setAddPayOpen(false)} onDone={load} />
      ) : null}
      {notifyOpen ? (
        <NotifyDialog candidateId={candidate.id} candidateName={name} onClose={() => setNotifyOpen(false)} />
      ) : null}
      {renameOpen ? (
        <RenameDialog
          candidateId={candidate.id}
          current={fullName}
          onClose={() => setRenameOpen(false)}
          onSaved={(next) => setFullName(next)}
        />
      ) : null}
      {feedbackReq ? (
        <FeedbackDialog
          request={feedbackReq}
          candidateName={name}
          adminId={adminId}
          onClose={() => setFeedbackReq(null)}
          onDone={load}
        />
      ) : null}
      {resetResult ? (
        <Dialog open onClose={() => setResetResult(null)} title="New password set" description="Give these to the candidate — shown once.">
          <div className="space-y-3 text-[13px]">
            {resetResult.email ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/40">Email</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-white/85">{resetResult.email}</code>
                  <CopyButton value={resetResult.email} title="Copy email" />
                </div>
              </div>
            ) : null}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/40">New password</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-white/85">{resetResult.password}</code>
                <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(resetResult.password)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </div>
            <p className="rounded-lg bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[#fbbf24] ring-1 ring-inset ring-[#f59e0b]/25">
              Save this now — it won&apos;t be shown again. Ask the candidate to change it after they log in.
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function TagsCard({ candidateId, initial }: { candidateId: string; initial: string[] }) {
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState("");

  async function persist(next: string[]) {
    setTags(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_candidate_tags", { p_user: candidateId, p_tags: next });
    if (error) toast({ title: "Couldn't update tags", description: error.message, variant: "error" });
  }
  function add() {
    const t = input.trim();
    if (!t || tags.includes(t)) {
      setInput("");
      return;
    }
    persist([...tags, t]);
    setInput("");
  }

  return (
    <SectionCard title="Tags" description="Label this candidate." icon={Tags}>
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 ? <span className="text-[12px] text-white/30">No tags yet.</span> : null}
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#6366f1]/[0.12] px-2 py-0.5 text-[12px] text-[#c7d2fe]">
            {t}
            <button type="button" onClick={() => persist(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              <X className="h-3 w-3 opacity-70 hover:opacity-100" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add a tag and press Enter"
          className="h-9"
        />
      </div>
    </SectionCard>
  );
}

function MaterialsCard({ materials, candidateId }: { materials?: CandidateMaterials; candidateId: string }) {
  const { toast } = useToast();
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!materials) return null;
  const hasUpload = !!materials.resume_path && !gone;
  const links = [
    { icon: FileText, label: "Résumé / CV link", href: materials.resume_url },
    { icon: Globe, label: "Portfolio", href: materials.portfolio_url },
    { icon: Linkedin, label: "LinkedIn", href: materials.linkedin_url },
    { icon: Github, label: "GitHub", href: materials.github_url },
  ].filter((l) => l.href);
  if (!hasUpload && links.length === 0 && !materials.phone) return null;

  async function removeUpload() {
    if (!materials?.resume_path) return;
    if (!window.confirm("Delete this candidate's uploaded résumé file?")) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.storage.from("resumes").remove([materials.resume_path]);
    const { error } = await supabase.rpc("admin_clear_resume", { p_user: candidateId });
    setBusy(false);
    if (error) return toast({ title: "Couldn't remove", description: error.message, variant: "error" });
    setGone(true);
    toast({ title: "Résumé removed", variant: "success" });
  }

  return (
    <SectionCard title="Links & contact" description="Shared by the candidate." icon={Link2}>
      <ul className="space-y-2">
        {materials.phone ? (
          <li className="flex items-center gap-2.5 text-[13px] text-white/75">
            <Phone className="h-4 w-4 text-white/40" />
            {materials.phone}
            <CopyButton value={materials.phone} title="Copy phone" className="ml-auto" />
          </li>
        ) : null}
        {hasUpload ? (
          <li className="flex items-center gap-2.5 text-[13px]">
            <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
            {materials.resume_signed_url ? (
              <a href={materials.resume_signed_url} target="_blank" rel="noreferrer" className="truncate text-[#a5b4fc] hover:text-[#c7d2fe]">
                Résumé (uploaded)
              </a>
            ) : (
              <span className="truncate text-white/70">Résumé (uploaded)</span>
            )}
            <button
              type="button"
              onClick={removeUpload}
              disabled={busy}
              className="ml-auto shrink-0 rounded-md p-1 text-white/30 transition hover:bg-white/[0.06] hover:text-[#f87171] disabled:opacity-50"
              aria-label="Delete uploaded résumé"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ) : null}
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <li key={l.label} className="flex items-center gap-1">
              <a
                href={l.href as string}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center gap-2.5 truncate text-[13px] text-[#a5b4fc] hover:text-[#c7d2fe]"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{l.label}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
              </a>
              <CopyButton value={l.href as string} title={`Copy ${l.label}`} />
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function AddPaymentDialog({
  candidateId,
  candidateName,
  onClose,
  onDone,
}: {
  candidateId: string;
  candidateName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("payments").insert({
      candidate_id: candidateId,
      amount: value,
      currency: "USD",
      method,
      status: "paid",
      paid_at: date ? new Date(date).toISOString() : new Date().toISOString(),
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
    <Dialog open onClose={onClose} title="Add payment" description={candidateName}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (USD)" htmlFor="cd-amt">
            <Input id="cd-amt" inputMode="decimal" placeholder="150.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="cd-date">
            <Input id="cd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Method" htmlFor="cd-method">
          <Select id="cd-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="cd-notes" hint="Optional.">
          <Textarea id="cd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={save}>
          Record payment
        </Button>
      </div>
    </Dialog>
  );
}

function RenameDialog({
  candidateId,
  current,
  onClose,
  onSaved,
}: {
  candidateId: string;
  current: string | null;
  onClose: () => void;
  onSaved: (next: string | null) => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const next = value.trim() || null;
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ full_name: next }).eq("id", candidateId);
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't rename", description: error.message, variant: "error" });
      return;
    }
    onSaved(next);
    toast({ title: "Name updated", variant: "success" });
    notifyChanged("interviews");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Rename user" description="Set a display name that's easier for you to track.">
      <div className="space-y-4">
        <Field label="Display name" htmlFor="rn-name">
          <Input
            id="rn-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. John (frontend) — Acme"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </Field>
        <p className="text-[12px] text-white/40">This changes the name shown across your admin views for this user.</p>
        <Button className="w-full" loading={busy} onClick={save}>
          Save name
        </Button>
      </div>
    </Dialog>
  );
}

function NotifyDialog({
  candidateId,
  candidateName,
  onClose,
}: {
  candidateId: string;
  candidateName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!title.trim() || !message.trim()) {
      setError("Add a title and message.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: candidateId,
      title: title.trim(),
      detail: message.trim(),
      type: "info",
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    toast({ title: "Message sent", variant: "success" });
    setBusy(false);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Send a message" description={`Notify ${candidateName}`}>
      <div className="space-y-4">
        <Field label="Title" htmlFor="nt-title">
          <Input id="nt-title" placeholder="Quick update" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Message" htmlFor="nt-msg">
          <Textarea id="nt-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your message…" />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={send}>
          <Send className="h-4 w-4" /> Send notification
        </Button>
      </div>
    </Dialog>
  );
}
