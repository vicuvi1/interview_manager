"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Github,
  Globe,
  Linkedin,
  MessageSquarePlus,
  Phone,
  StickyNote,
  Tags,
  Wallet,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatAmount } from "@/lib/payments";
import { REJECTED, STAGES, STAGE_LABEL } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import type { CandidateLite, CandidateNote, InterviewRequest } from "@/lib/types";

/** The candidate profile fields we pull for the peek (a superset of ProfileLite
 *  plus the contact/link columns that live on the profiles row). */
interface PeekProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string;
  role: string;
  stage: string | null;
  tags: string[] | null;
  created_at: string;
  resume_url: string | null;
  resume_path: string | null;
  portfolio_url: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  phone: string | null;
}

interface PeekPayment {
  amount: number;
  currency: string;
  status: string;
}

// Stage options for the quick-edit select — the pipeline stages plus Rejected.
const STAGE_OPTIONS: { value: string; label: string }[] = [
  ...STAGES,
  { value: REJECTED, label: STAGE_LABEL[REJECTED] ?? "Rejected" },
];

/**
 * A right-side slide-over that shows a candidate's full context — links,
 * pipeline stage, interview history, payments, and notes — without leaving the
 * current list. Built for "always see the info" from requests/dashboard views.
 */
export function CandidatePeek({
  candidateId,
  seed,
  adminId,
  adminTimezone,
  onClose,
}: {
  candidateId: string;
  /** Optional header seed so the panel isn't blank while data loads. */
  seed?: CandidateLite;
  /** Note author. When omitted we resolve the signed-in admin at write time. */
  adminId?: string;
  adminTimezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<PeekProfile | null>(null);
  const [requests, setRequests] = useState<InterviewRequest[]>([]);
  const [payments, setPayments] = useState<PeekPayment[]>([]);
  const [notes, setNotes] = useState<CandidateNote[]>([]);
  const [resumeSignedUrl, setResumeSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: prof }, { data: reqs }, { data: pays }, { data: n }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, timezone, role, stage, tags, created_at, resume_url, resume_path, portfolio_url, linkedin_url, github_url, phone")
        .eq("id", candidateId)
        .maybeSingle(),
      supabase.from("interview_requests").select("*").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
      supabase.from("payments").select("amount, currency, status").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
      supabase.from("candidate_notes").select("*").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
    ]);
    const p = (prof as PeekProfile | null) ?? null;
    setProfile(p);
    setRequests((reqs as InterviewRequest[] | null) ?? []);
    setPayments((pays as PeekPayment[] | null) ?? []);
    setNotes((n as CandidateNote[] | null) ?? []);
    setLoading(false);
    // Try to sign the uploaded résumé so admins can open it. Storage policy may
    // disallow it for other users' files — fall back to a plain label if so.
    if (p?.resume_path) {
      const { data: signed } = await supabase.storage.from("resumes").createSignedUrl(p.resume_path, 300);
      setResumeSignedUrl(signed?.signedUrl ?? null);
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes; move focus into the panel on open.
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kpis = useMemo(() => {
    const now = Date.now();
    let completed = 0, upcoming = 0, paid = 0, outstanding = 0;
    for (const r of requests) {
      if (r.status === "completed") completed += 1;
      if (r.status === "scheduled" && r.scheduled_at && new Date(r.scheduled_at).getTime() >= now) upcoming += 1;
    }
    for (const p of payments) {
      const amt = Number(p.amount) || 0;
      if (p.status === "paid") paid += amt;
      else if (p.status === "pending" || p.status === "overdue" || p.status === "partial") outstanding += amt;
    }
    return { total: requests.length, completed, upcoming, paid, outstanding };
  }, [requests, payments]);

  const name = profile?.full_name || seed?.full_name || profile?.email || seed?.email || "Candidate";
  const email = profile?.email ?? seed?.email ?? null;
  const timezone = profile?.timezone ?? seed?.timezone ?? "UTC";

  const links = useMemo(
    () =>
      [
        { icon: FileText, label: "Résumé / CV link", href: profile?.resume_url },
        { icon: Globe, label: "Portfolio", href: profile?.portfolio_url },
        { icon: Linkedin, label: "LinkedIn", href: profile?.linkedin_url },
        { icon: Github, label: "GitHub", href: profile?.github_url },
      ].filter((l) => l.href),
    [profile],
  );

  async function addNote() {
    const body = noteBody.trim();
    if (!body) return;
    setSavingNote(true);
    const supabase = createClient();
    const author = adminId ?? (await supabase.auth.getUser()).data.user?.id ?? null;
    const { error } = await supabase.from("candidate_notes").insert({ candidate_id: candidateId, body, created_by: author });
    setSavingNote(false);
    if (error) {
      toast({ title: "Couldn't save note", description: error.message, variant: "error" });
      return;
    }
    setNoteBody("");
    load();
  }

  async function changeStage(next: string) {
    if (!profile || next === profile.stage) return;
    const prev = profile.stage;
    setProfile({ ...profile, stage: next });
    setStageBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_candidate_stage", { p_user: candidateId, p_stage: next });
    setStageBusy(false);
    if (error) {
      setProfile((p) => (p ? { ...p, stage: prev } : p));
      toast({ title: "Couldn't update stage", description: error.message, variant: "error" });
    }
  }

  async function persistTags(next: string[]) {
    if (!profile) return;
    const prev = profile.tags ?? [];
    setProfile({ ...profile, tags: next });
    const supabase = createClient();
    const { error } = await supabase.rpc("set_candidate_tags", { p_user: candidateId, p_tags: next });
    if (error) {
      setProfile((p) => (p ? { ...p, tags: prev } : p));
      toast({ title: "Couldn't update tags", description: error.message, variant: "error" });
    }
  }

  function addTag() {
    const t = tagInput.trim();
    const cur = profile?.tags ?? [];
    if (!t || cur.includes(t)) {
      setTagInput("");
      return;
    }
    persistTags([...cur, t]);
    setTagInput("");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} — candidate details`}
        className="flex h-full w-full max-w-[440px] animate-fade-in flex-col border-l border-white/[0.08] bg-[#13131a] outline-none"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-sm font-semibold text-white">
            {initials(name, email)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-medium text-[#f0f0f5]">{name}</h3>
              {profile?.stage ? <Badge tone="indigo">{profile.stage}</Badge> : null}
            </div>
            {email ? (
              <p className="flex items-center gap-1 truncate text-[12px] text-white/50">
                {email}
                <CopyButton value={email} title="Copy email" className="h-5 w-5" />
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-white/35">
              {timezone}
              {profile ? ` · joined ${relativeTime(profile.created_at)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-10 text-center text-[12px] text-white/35">Loading…</p>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-2">
                <Stat icon={CalendarCheck} tone="indigo" label="Interviews" value={String(kpis.total)} />
                <Stat icon={CalendarClock} tone="blue" label="Upcoming" value={String(kpis.upcoming)} />
                <Stat icon={Wallet} tone="green" label="Paid" value={formatAmount(kpis.paid)} />
                <Stat icon={Clock} tone="amber" label="Outstanding" value={formatAmount(kpis.outstanding)} />
              </div>

              {/* Pipeline stage + tags — editable inline. */}
              <Section icon={Tags} title="Pipeline & tags">
                <div className="space-y-3">
                  <Select
                    value={profile?.stage ?? "applied"}
                    disabled={stageBusy}
                    onChange={(e) => changeStage(e.target.value)}
                    aria-label="Pipeline stage"
                  >
                    {STAGE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  <div>
                    <div className="flex flex-wrap gap-1.5">
                      {(profile?.tags ?? []).length === 0 ? (
                        <span className="text-[12px] text-white/30">No tags yet.</span>
                      ) : null}
                      {(profile?.tags ?? []).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-[#6366f1]/[0.12] px-2 py-0.5 text-[12px] text-[#c7d2fe]"
                        >
                          {t}
                          <button
                            type="button"
                            onClick={() => persistTags((profile?.tags ?? []).filter((x) => x !== t))}
                            aria-label={`Remove ${t}`}
                          >
                            <X className="h-3 w-3 opacity-70 hover:opacity-100" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder="Add a tag and press Enter"
                      className="mt-2 h-9"
                    />
                  </div>
                </div>
              </Section>

              {/* Links & contact */}
              {profile?.phone || resumeSignedUrl || (profile?.resume_path && !resumeSignedUrl) || links.length > 0 ? (
                <Section icon={FileText} title="Links & contact">
                  <ul className="space-y-2">
                    {profile?.phone ? (
                      <li className="flex items-center gap-2.5 text-[13px] text-white/75">
                        <Phone className="h-4 w-4 text-white/40" />
                        {profile.phone}
                        <CopyButton value={profile.phone} title="Copy phone" className="ml-auto" />
                      </li>
                    ) : null}
                    {profile?.resume_path ? (
                      <li className="flex items-center gap-2.5 text-[13px]">
                        <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
                        {resumeSignedUrl ? (
                          <a href={resumeSignedUrl} target="_blank" rel="noreferrer" className="truncate text-[#a5b4fc] hover:text-[#c7d2fe]">
                            Résumé (uploaded)
                          </a>
                        ) : (
                          <span className="truncate text-white/70">Résumé (uploaded)</span>
                        )}
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
                </Section>
              ) : null}

              {/* Interview history */}
              <Section icon={CalendarCheck} title="Interview history">
                {requests.length === 0 ? (
                  <EmptyState icon={CalendarCheck} title="No interviews yet" />
                ) : (
                  <ul className="space-y-2">
                    {requests.map((r) => (
                      <li key={r.id} className="rounded-lg bg-white/[0.03] px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-[#f0f0f5]">{r.role}</span>
                          <StatusBadge status={r.status} />
                          <Badge tone={r.payment_status === "paid" ? "green" : "amber"}>{r.payment_status}</Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-white/40">
                          {formatInTimeZone(r.scheduled_at ?? r.preferred_at, adminTimezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Notes */}
              <Section icon={StickyNote} title="Private notes">
                <div className="space-y-2.5">
                  <Textarea
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Add a note…"
                    className="min-h-[60px]"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" loading={savingNote} disabled={!noteBody.trim()} onClick={addNote}>
                      <MessageSquarePlus className="h-4 w-4" /> Add note
                    </Button>
                  </div>
                  {notes.length === 0 ? (
                    <p className="py-1 text-center text-[12px] text-white/30">No notes yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {notes.map((n) => (
                        <li key={n.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                          <p className="whitespace-pre-wrap text-[13px] text-white/80">{n.body}</p>
                          <span className="mt-1 block text-[11px] text-white/30">{relativeTime(n.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">
          <Link
            href={`/admin/candidates/${candidateId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
          >
            Open full profile <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof FileText;
  tone: "indigo" | "blue" | "green" | "amber";
  label: string;
  value: string;
}) {
  const toneCls: Record<string, string> = {
    indigo: "text-[#a5b4fc]",
    blue: "text-[#93c5fd]",
    green: "text-[#34d399]",
    amber: "text-[#fbbf24]",
  };
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", toneCls[tone])} />
        <span className="text-[11px] text-white/40">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[#f0f0f5]">{value}</p>
    </div>
  );
}
