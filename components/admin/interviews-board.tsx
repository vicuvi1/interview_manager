"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Clock, Download, ExternalLink, FileText, History, Inbox, Search, Send, Settings2 } from "lucide-react";

import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { cn, formatMoney } from "@/lib/utils";
import type { CandidateLite, InterviewRequest, ProfileLite } from "@/lib/types";

type Filter = "all" | "upcoming" | "today" | "needs" | "completed" | "unpaid";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "today", label: "Today" },
  { key: "needs", label: "Needs scheduling" },
  { key: "completed", label: "Completed" },
  { key: "unpaid", label: "Unpaid" },
];

const effTime = (r: InterviewRequest) => r.scheduled_at ?? r.preferred_at ?? null;
const isPast = (r: InterviewRequest) => {
  if (r.status === "completed" || r.status === "cancelled" || r.status === "rejected") return true;
  const t = effTime(r);
  return !!t && new Date(t).getTime() < Date.now();
};

export function InterviewsBoard({
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
  const [profiles] = useState<ProfileLite[]>(initialProfiles);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Record<string, { id: string; summary: string; created_at: string }[]>>({});
  const [manage, setManage] = useState<InterviewRequest | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = (id: string) => candidates[id]?.full_name || candidates[id]?.email || "Candidate";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("interview_requests").select("*").order("scheduled_at", { ascending: false });
    if (data) setRequests(data as InterviewRequest[]);
  }, []);
  useDataChanged("interviews", load);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-interviews")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const counts = useMemo(
    () => ({
      upcoming: requests.filter((r) => !isPast(r)).length,
      completed: requests.filter((r) => r.status === "completed").length,
      unpaid: requests.filter((r) => r.payment_status !== "paid" && (r.price_cents ?? 0) > 0).length,
    }),
    [requests],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const todayKey = todayKeyInTimeZone(adminTimezone);
    const matches = requests.filter((r) => {
      if (filter === "upcoming" && isPast(r)) return false;
      if (filter === "completed" && r.status !== "completed") return false;
      if (filter === "unpaid" && !(r.payment_status !== "paid" && (r.price_cents ?? 0) > 0)) return false;
      if (filter === "today" && !(r.status === "scheduled" && r.scheduled_at && dateKeyInTimeZone(r.scheduled_at, adminTimezone) === todayKey)) return false;
      if (filter === "needs" && !((r.status === "pending" || r.status === "approved") && !r.scheduled_at)) return false;
      if (!q) return true;
      const cand = candidates[r.candidate_id];
      return (
        r.role.toLowerCase().includes(q) ||
        (cand?.full_name ?? "").toLowerCase().includes(q) ||
        (cand?.email ?? "").toLowerCase().includes(q)
      );
    });
    const upcoming = matches
      .filter((r) => !isPast(r))
      .sort((a, b) => (new Date(effTime(a) ?? 0).getTime() || Infinity) - (new Date(effTime(b) ?? 0).getTime() || Infinity));
    const past = matches
      .filter((r) => isPast(r))
      .sort((a, b) => new Date(effTime(b) ?? 0).getTime() - new Date(effTime(a) ?? 0).getTime());
    return { upcoming, past };
  }, [requests, filter, query, candidates, adminTimezone]);

  async function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!history[id]) {
      const supabase = createClient();
      const { data } = await supabase
        .from("audit_log")
        .select("id, summary, created_at")
        .eq("entity_type", "interview")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      setHistory((h) => ({ ...h, [id]: (data as { id: string; summary: string; created_at: string }[] | null) ?? [] }));
    }
  }

  // Core send used by both the single-row button and the bulk action.
  async function sendOne(r: InterviewRequest): Promise<string | null> {
    const tz = candidates[r.candidate_id]?.timezone ?? adminTimezone;
    const whenTxt = r.scheduled_at
      ? formatInTimeZone(r.scheduled_at, tz)
      : r.preferred_at
        ? `${formatInTimeZone(r.preferred_at, tz)} (requested)`
        : "TBD";
    const parts = [`Your interview for "${r.role}" is on ${whenTxt}.`];
    if (r.meeting_link) parts.push(`Join: ${r.meeting_link}`);
    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .insert({ user_id: r.candidate_id, title: "Meeting details", detail: parts.join(" "), type: "info" });
    if (error) return error.message;
    // Record the send so the row can show "details sent … ago".
    await supabase.from("interview_requests").update({ details_sent_at: new Date().toISOString() }).eq("id", r.id);
    return null;
  }

  async function sendDetails(r: InterviewRequest) {
    setSending(r.id);
    const err = await sendOne(r);
    setSending(null);
    if (err) {
      toast({ title: "Couldn't send", description: err, variant: "error" });
      return;
    }
    toast({ title: "Details sent to candidate", description: "Also forwarded by Telegram / email.", variant: "success" });
    notifyChanged("interviews");
  }

  function exportCsv() {
    const all = [...rows.upcoming, ...rows.past];
    const body = all.map((r) => [
      candName(r.candidate_id),
      candidates[r.candidate_id]?.email ?? "",
      r.role,
      r.interview_type ?? "",
      effTime(r) ? formatInTimeZone(effTime(r), adminTimezone) : "",
      r.scheduled_at ? "scheduled" : r.preferred_at ? "requested" : "",
      r.duration_minutes,
      r.status,
      r.payment_status,
      r.price_cents ? formatMoney(r.price_cents, r.currency) : "",
      r.meeting_link ?? "",
    ]);
    const csv = toCsv(
      ["Candidate", "Email", "Role", "Type", "When", "When type", "Duration (min)", "Status", "Payment", "Amount", "Meeting link"],
      body,
    );
    downloadCsv(`interviews-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSend() {
    const byId = new Map(requests.map((r) => [r.id, r]));
    const targets = Array.from(selected).map((id) => byId.get(id)).filter(Boolean) as InterviewRequest[];
    setBulkBusy(true);
    let ok = 0;
    for (const r of targets) {
      if (!(await sendOne(r))) ok += 1;
    }
    setBulkBusy(false);
    setSelected(new Set());
    notifyChanged("interviews");
    toast({ title: `Details sent to ${ok} candidate${ok === 1 ? "" : "s"}`, variant: "success" });
  }

  async function bulkMarkPaid() {
    const byId = new Map(requests.map((r) => [r.id, r]));
    const targets = Array.from(selected).map((id) => byId.get(id)).filter(Boolean) as InterviewRequest[];
    const ids = targets.map((r) => r.id);
    setBulkBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .in("id", ids);
    if (!error) {
      await supabase.from("notifications").insert(
        targets.map((r) => ({
          user_id: r.candidate_id,
          title: "Payment confirmed",
          detail: `Your payment for "${r.role}" is confirmed. Thank you!`,
          type: "success",
        })),
      );
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (error) {
      toast({ title: "Couldn't mark paid", description: error.message, variant: "error" });
      return;
    }
    notifyChanged("interviews");
    toast({ title: `Marked ${ids.length} paid`, variant: "success" });
  }

  async function viewResume(r: InterviewRequest) {
    if (r.resume_url) {
      window.open(r.resume_url, "_blank", "noopener");
      return;
    }
    if (!r.resume_path) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(r.resume_path, 60);
    if (error || !data) {
      toast({ title: "Couldn't open résumé", description: error?.message, variant: "error" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const paymentBadge = (r: InterviewRequest) => {
    if (r.payment_status === "paid")
      return <Badge tone="green">Paid{r.price_cents ? ` · ${formatMoney(r.price_cents, r.currency)}` : ""}</Badge>;
    if ((r.price_cents ?? 0) > 0) return <Badge tone="amber">Unpaid · {formatMoney(r.price_cents!, r.currency)}</Badge>;
    return <Badge tone="slate">No invoice</Badge>;
  };

  const renderRow = (r: InterviewRequest) => {
    const open = expanded.has(r.id);
    const t = effTime(r);
    const hasMinutes = r.status === "completed" && (r.actual_minutes || r.completion_notes || r.recording_url);
    return (
      <div key={r.id} className="border-b border-white/[0.06] last:border-b-0">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <input
            type="checkbox"
            checked={selected.has(r.id)}
            onChange={() => toggleSelect(r.id)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
            aria-label={`Select ${r.role}`}
          />
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: r.color ?? "rgba(255,255,255,0.18)" }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-[#f0f0f5]">{r.role}</span>
              {r.interview_type ? <Badge tone="slate">{r.interview_type}</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/45">
              {candName(r.candidate_id)}
              <span className="text-white/30"> · {candidates[r.candidate_id]?.email}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-white/60">
              <Clock className="h-3.5 w-3.5 text-white/35" />
              {t ? formatInTimeZone(t, adminTimezone) : "Not scheduled"}
              {!r.scheduled_at && r.preferred_at ? <span className="text-white/35">(requested)</span> : null}
              <span className="text-white/30">· {r.duration_minutes} min</span>
            </p>
          </div>
          <div className="flex w-full flex-col items-start gap-1.5 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={r.status} />
              {paymentBadge(r)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              {r.meeting_link ? (
                <>
                  <a href={r.meeting_link} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]">
                      <ExternalLink className="h-3.5 w-3.5" /> Join
                    </Button>
                  </a>
                  <CopyButton value={r.meeting_link} title="Copy meeting link" className="h-7 w-7" />
                </>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[12px]"
                loading={sending === r.id}
                disabled={sending === r.id || (!r.scheduled_at && !r.meeting_link && !r.preferred_at)}
                onClick={() => sendDetails(r)}
              >
                <Send className="h-3.5 w-3.5" /> Send
              </Button>
              <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]" onClick={() => setManage(r)}>
                <Settings2 className="h-3.5 w-3.5" /> Manage
              </Button>
              {r.details_sent_at ? (
                <span className="text-[11px] text-white/35" title={`Meeting details sent ${relativeTime(r.details_sent_at)}`}>
                  sent {relativeTime(r.details_sent_at)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => toggleExpand(r.id)}
                className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                aria-label="Details"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </button>
            </div>
          </div>
        </div>
        {open ? (
          <div className="space-y-3 bg-white/[0.015] px-4 pb-4 pt-1 sm:px-5">
            {hasMinutes ? (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  <FileText className="h-3.5 w-3.5" /> Meeting minutes
                </p>
                {r.actual_minutes ? <p className="text-[12px] text-white/60">Lasted {r.actual_minutes} min</p> : null}
                {r.recording_url ? (
                  <a
                    href={r.recording_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-[#a5b4fc] hover:text-[#c7d2fe]"
                  >
                    Recording / notes link <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                {r.completion_notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-white/70">{r.completion_notes}</p>
                ) : null}
              </div>
            ) : null}
            {r.notes ? (
              <div className="text-[12.5px]">
                <span className="text-[11px] uppercase tracking-wide text-white/40">Notes</span>
                <p className="whitespace-pre-wrap text-white/70">{r.notes}</p>
              </div>
            ) : null}
            {r.resume_path || r.resume_url || r.portfolio_url || r.linkedin_url || r.github_url || r.applicant_phone ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  <FileText className="h-3.5 w-3.5" /> Submitted materials
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  {r.resume_path || r.resume_url ? (
                    <button
                      type="button"
                      onClick={() => viewResume(r)}
                      className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 text-[#a5b4fc] hover:bg-white/[0.08]"
                    >
                      Résumé <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : null}
                  {r.portfolio_url ? (
                    <a href={r.portfolio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 text-[#a5b4fc] hover:bg-white/[0.08]">
                      Portfolio <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {r.linkedin_url ? (
                    <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 text-[#a5b4fc] hover:bg-white/[0.08]">
                      LinkedIn <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {r.github_url ? (
                    <a href={r.github_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 text-[#a5b4fc] hover:bg-white/[0.08]">
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {r.applicant_phone ? (
                    <span className="rounded-md bg-white/[0.05] px-2 py-1 text-white/60">☎ {r.applicant_phone}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                <History className="h-3.5 w-3.5" /> History
              </p>
              {history[r.id] === undefined ? (
                <p className="text-[12px] text-white/35">Loading…</p>
              ) : history[r.id].length === 0 ? (
                <p className="text-[12px] text-white/35">No changes recorded yet.</p>
              ) : (
                <ul className="space-y-1">
                  {history[r.id].map((h) => (
                    <li key={h.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="text-white/70">{h.summary}</span>
                      <span className="shrink-0 text-white/35">{relativeTime(h.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {r.last_edited_at ? (
                <p className="mt-1 text-[11px] text-white/30">Last edited {relativeTime(r.last_edited_at)}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const hasAny = rows.upcoming.length + rows.past.length > 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/60">
          <span className="font-semibold text-[#f0f0f5]">{counts.upcoming}</span> upcoming
        </span>
        <span className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/60">
          <span className="font-semibold text-[#f0f0f5]">{counts.completed}</span> completed
        </span>
        <span className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/60">
          <span className="font-semibold text-[#fbbf24]">{counts.unpaid}</span> unpaid
        </span>
      </div>

      <Card className="animate-fade-in overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  filter === f.key ? "bg-[#6366f1]/[0.15] text-[#c7d2fe]" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search candidate or role…"
                className="pl-9"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={exportCsv}
              disabled={rows.upcoming.length + rows.past.length === 0}
              title="Export the current list as CSV"
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#6366f1]/[0.06] px-3 py-2.5 sm:px-4">
            <span className="text-[13px] font-medium text-[#c7d2fe]">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" loading={bulkBusy} disabled={bulkBusy} onClick={bulkSend}>
                <Send className="h-3.5 w-3.5" /> Send details
              </Button>
              <Button size="sm" variant="secondary" loading={bulkBusy} disabled={bulkBusy} onClick={bulkMarkPaid}>
                Mark paid
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md px-2 py-1 text-[12px] text-white/50 hover:bg-white/[0.06] hover:text-white/80"
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {!hasAny ? (
          <div className="p-6">
            <EmptyState icon={Inbox} title="No interviews" description="Interviews will appear here as they're requested and scheduled." />
          </div>
        ) : (
          <div>
            {rows.upcoming.length > 0 ? (
              <>
                <p className="bg-white/[0.02] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40 sm:px-5">
                  Upcoming
                </p>
                {rows.upcoming.map(renderRow)}
              </>
            ) : null}
            {rows.past.length > 0 ? (
              <>
                <p className="bg-white/[0.02] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40 sm:px-5">
                  Past
                </p>
                {rows.past.map(renderRow)}
              </>
            ) : null}
          </div>
        )}
      </Card>

      {manage ? (
        <ManageRequestDialog
          request={manage}
          candidates={candidates}
          adminTimezone={adminTimezone}
          requests={requests}
          onClose={() => setManage(null)}
        />
      ) : null}
    </>
  );
}
