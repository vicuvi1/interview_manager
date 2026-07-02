"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, CheckCheck, ClipboardCheck, Plus, Search, Slash, X } from "lucide-react";

import { FeedbackDialog } from "@/components/admin/feedback-dialog";
import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { ScheduleDialog } from "@/components/admin/schedule-dialog";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDataChanged } from "@/lib/bus";
import { useDebouncedCallback } from "@/lib/use-debounced";
import { FORMAT_LABEL } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime, wallTimeToUtcISO } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import type { AvailabilitySlot, CandidateLite, InterviewRequest, InterviewTemplate, ProfileLite } from "@/lib/types";

const STATUSES = ["pending", "approved", "scheduled", "completed", "cancelled", "rejected"] as const;

const STATUS_TITLE: Record<string, string> = {
  approved: "Request approved",
  scheduled: "Interview scheduled",
  completed: "Interview completed",
  cancelled: "Interview cancelled",
  rejected: "Request declined",
  pending: "Request reopened",
};
const STATUS_NTYPE: Record<string, string> = {
  approved: "approved",
  scheduled: "approved",
  completed: "success",
  cancelled: "alert",
  rejected: "rejected",
  pending: "info",
};

export function RequestsConsole({
  adminId,
  adminTimezone,
  initialRequests,
  initialProfiles,
  initialSlots,
}: {
  adminId: string;
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialProfiles: ProfileLite[];
  initialSlots: AvailabilitySlot[];
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialProfiles);
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initialSlots);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notify, setNotify] = useState(true);
  const [forceStatus, setForceStatus] = useState<string>("scheduled");
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState<InterviewRequest | null>(null);
  const [schedule, setSchedule] = useState<InterviewRequest | null>(null);
  const [feedback, setFeedback] = useState<InterviewRequest | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [views, setViews] = useState<{ name: string; filter: string; query: string }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("im:req-views");
      if (raw) setViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  function persistViews(next: { name: string; filter: string; query: string }[]) {
    setViews(next);
    try {
      localStorage.setItem("im:req-views", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function saveView() {
    const nm = window.prompt("Name this view:")?.trim();
    if (!nm) return;
    persistViews([...views.filter((v) => v.name !== nm), { name: nm, filter, query }]);
  }

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = (id: string) => candidates[id]?.full_name || candidates[id]?.email || "Candidate";

  const admins = useMemo(() => profiles.filter((p) => p.role === "admin"), [profiles]);
  const interviewerName = (id: string | null) => {
    if (!id) return null;
    const iv = profiles.find((p) => p.id === id);
    return iv ? iv.full_name || iv.email : null;
  };

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: profs }, { data: sl }] = await Promise.all([
      supabase.from("interview_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
      supabase.from("availability_slots").select("*"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (profs) setProfiles(profs as ProfileLite[]);
    if (sl) setSlots(sl as AvailabilitySlot[]);
  }, []);

  const reload = useDebouncedCallback(load);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-requests-console")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);
  useDataChanged("interviews", load);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const s of STATUSES) c[s] = 0;
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return candName(r.candidate_id).toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, filter, query, candidates]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (filtered.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        filtered.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function applyStatus(target: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const rowsSel = requests.filter((r) => selected.has(r.id));
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("interview_requests").update({ status: target }).in("id", ids);
    if (error) {
      toast({ title: "Bulk update failed", description: error.message, variant: "error" });
      setBusy(false);
      return;
    }
    if (notify) {
      const notifs = rowsSel.map((r) => ({
        user_id: r.candidate_id,
        title: STATUS_TITLE[target] ?? "Request updated",
        detail: `Your request for "${r.role}" is now ${target}.`,
        type: STATUS_NTYPE[target] ?? "info",
      }));
      if (notifs.length) await supabase.from("notifications").insert(notifs);
    }
    toast({ title: `Updated ${ids.length} request${ids.length === 1 ? "" : "s"}`, variant: "success" });
    setSelected(new Set());
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Requests</h1>
          <p className="text-[12px] text-white/40">Triage, override, and bulk-manage every request.</p>
        </div>
        <Button size="sm" onClick={() => setBookingOpen(true)}>
          <CalendarPlus className="h-4 w-4" /> New booking
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...STATUSES] as string[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium capitalize transition-colors",
              filter === s
                ? "bg-[#6366f1]/[0.16] text-[#c7d2fe] ring-1 ring-inset ring-[#6366f1]/30"
                : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
            )}
          >
            {s} <span className="text-white/30">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-white/30">Saved views:</span>
        {views.length === 0 ? <span className="text-[11px] text-white/25">none yet</span> : null}
        {views.map((v) => (
          <span key={v.name} className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-1 text-[12px] text-white/60">
            <button type="button" onClick={() => { setFilter(v.filter); setQuery(v.query); }} className="hover:text-white/90">
              {v.name}
            </button>
            <button type="button" onClick={() => persistViews(views.filter((x) => x.name !== v.name))} aria-label={`Delete ${v.name}`}>
              <X className="h-3 w-3 opacity-50 hover:opacity-100" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={saveView}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2 py-1 text-[12px] text-white/50 hover:border-white/25 hover:text-white/80"
        >
          <Plus className="h-3 w-3" /> Save current
        </button>
      </div>

      <SectionCard
        title="All requests"
        description={`${filtered.length} shown`}
        icon={CheckCheck}
        bodyClassName="p-0 sm:p-0"
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or role…"
              className="h-9 w-52 pl-9"
            />
          </div>
        }
      >
        {/* Bulk action bar */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#6366f1]/[0.05] px-5 py-2.5 sm:px-6">
            <span className="text-[12px] font-medium text-[#c7d2fe]">{selected.size} selected</span>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-white/60">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
              />
              Notify
            </label>
            <div className="mx-1 h-4 w-px bg-white/10" />
            <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => applyStatus("approved")}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => applyStatus("completed")}>
              Complete
            </Button>
            <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => applyStatus("cancelled")}>
              Cancel
            </Button>
            <div className="mx-1 h-4 w-px bg-white/10" />
            <div className="flex items-center gap-1.5">
              <Slash className="h-3.5 w-3.5 text-white/40" />
              <Select value={forceStatus} onChange={(e) => setForceStatus(e.target.value)} className="h-8 w-36">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    Force: {s}
                  </option>
                ))}
              </Select>
              <Button size="sm" loading={busy} disabled={busy} onClick={() => applyStatus(forceStatus)}>
                Apply
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-white/70"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={CheckCheck} title="No requests" description="Nothing matches this filter." />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                  <th className="w-10 px-5 py-2.5 sm:px-6">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Candidate</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Payment</th>
                  <th className="px-5 py-2.5 font-medium sm:px-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className={cn("transition-colors hover:bg-white/[0.03]", selected.has(r.id) && "bg-[#6366f1]/[0.04]")}
                  >
                    <td className="px-5 py-3 sm:px-6">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="h-3.5 w-3.5 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                        aria-label={`Select ${candName(r.candidate_id)}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/candidates/${r.candidate_id}`} className="flex items-center gap-2.5 hover:opacity-90">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[10px] font-semibold text-white">
                          {initials(candidates[r.candidate_id]?.full_name, candidates[r.candidate_id]?.email)}
                        </span>
                        <span className="truncate font-medium text-[#f0f0f5]">{candName(r.candidate_id)}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: r.color ?? "rgba(255,255,255,0.18)" }}
                          aria-hidden
                        />
                        <span className="text-white/70">{r.role}</span>
                        {r.interview_type ? (
                          <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/50">{r.interview_type}</span>
                        ) : null}
                        {r.format ? (
                          <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/50">{FORMAT_LABEL[r.format] ?? r.format}</span>
                        ) : null}
                      </div>
                      {interviewerName(r.interviewer_id) ? (
                        <p className="mt-0.5 text-[11px] text-white/35">with {interviewerName(r.interviewer_id)}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {r.scheduled_at ? formatInTimeZone(r.scheduled_at, adminTimezone) : relativeTime(r.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={r.payment_status === "paid" ? "green" : "amber"}>{r.payment_status}</Badge>
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status !== "cancelled" && r.status !== "rejected" && r.status !== "completed" ? (
                          <Button size="sm" variant="secondary" onClick={() => setSchedule(r)} title="Schedule">
                            <CalendarClock className="h-4 w-4" />
                            {r.status === "scheduled" ? "Reschedule" : "Schedule"}
                          </Button>
                        ) : null}
                        {r.status === "scheduled" || r.status === "completed" ? (
                          <Button size="sm" variant="secondary" onClick={() => setFeedback(r)} title="Feedback">
                            <ClipboardCheck className="h-4 w-4" /> Feedback
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => setManage(r)}>
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

      {manage ? (
        <ManageRequestDialog
          request={manage}
          candidates={candidates}
          adminTimezone={adminTimezone}
          requests={requests}
          onClose={() => setManage(null)}
        />
      ) : null}
      {schedule ? (
        <ScheduleDialog
          request={schedule}
          candidate={candidates[schedule.candidate_id]}
          adminTimezone={adminTimezone}
          requests={requests}
          slots={slots}
          interviewers={admins}
          onClose={() => setSchedule(null)}
          onDone={load}
        />
      ) : null}
      {feedback ? (
        <FeedbackDialog
          request={feedback}
          candidateName={candName(feedback.candidate_id)}
          adminId={adminId}
          onClose={() => setFeedback(null)}
          onDone={load}
        />
      ) : null}
      {bookingOpen ? (
        <ManualBookingDialog
          profiles={profiles}
          interviewers={admins}
          adminTimezone={adminTimezone}
          onClose={() => setBookingOpen(false)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}

function ManualBookingDialog({
  profiles,
  interviewers,
  adminTimezone,
  onClose,
  onDone,
}: {
  profiles: ProfileLite[];
  interviewers: ProfileLite[];
  adminTimezone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const candidatesList = useMemo(() => profiles.filter((p) => p.role !== "admin"), [profiles]);
  const [candidateId, setCandidateId] = useState(candidatesList[0]?.id ?? "");
  const [role, setRole] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [link, setLink] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const [templates, setTemplates] = useState<InterviewTemplate[]>([]);
  const [interviewType, setInterviewType] = useState("");
  const [level, setLevel] = useState("");
  const [format, setFormat] = useState("video");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("interview_templates").select("*").order("name");
      if (data) setTemplates(data as InterviewTemplate[]);
    })();
  }, []);

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.role) setRole(t.role);
    setDuration(t.duration_minutes);
    setInterviewType(t.interview_type ?? "");
    setLevel(t.level ?? "");
    setFormat(t.format ?? "video");
  }

  async function save() {
    if (!candidateId) return setError("Select a candidate.");
    if (!role.trim()) return setError("Enter a role.");
    if (!when) return setError("Pick a date and time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const scheduledUtc = wallTimeToUtcISO(when, adminTimezone);
    const { error: insertError } = await supabase.from("interview_requests").insert({
      candidate_id: candidateId,
      role: role.trim(),
      interview_type: interviewType || null,
      level: level || null,
      format,
      preferred_at: scheduledUtc,
      scheduled_at: scheduledUtc,
      duration_minutes: duration,
      meeting_link: link.trim() || null,
      interviewer_id: interviewerId || null,
      status: "scheduled",
      payment_status: "unpaid",
      currency: "USD",
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    const cand = candidatesList.find((c) => c.id === candidateId);
    await supabase.from("notifications").insert({
      user_id: candidateId,
      title: "Interview scheduled",
      detail: `An interview for "${role.trim()}" was scheduled for you on ${formatInTimeZone(scheduledUtc, cand?.timezone ?? adminTimezone)}.`,
      type: "approved",
    });
    toast({ title: "Booking created", variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="New booking" description="Schedule an interview on a candidate's behalf.">
      <div className="space-y-4">
        {templates.length > 0 ? (
          <Field label="Start from template" htmlFor="mb-template" hint="Optional — prefills the fields below.">
            <Select id="mb-template" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— None —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Candidate" htmlFor="mb-cand">
          <Select id="mb-cand" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
            {candidatesList.length === 0 ? <option value="">No candidates</option> : null}
            {candidatesList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role" htmlFor="mb-role">
          <Input id="mb-role" placeholder="Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Date & time (${adminTimezone})`} htmlFor="mb-when">
            <Input id="mb-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Duration" htmlFor="mb-dur">
            <Select id="mb-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </Select>
          </Field>
        </div>
        {interviewers.length > 0 ? (
          <Field label="Interviewer" htmlFor="mb-interviewer" hint="Optional — who will run it.">
            <Select id="mb-interviewer" value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {interviewers.map((iv) => (
                <option key={iv.id} value={iv.id}>
                  {iv.full_name || iv.email}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Meeting link" htmlFor="mb-link" hint="Optional — shared with the candidate.">
          <Input id="mb-link" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={save}>
          Create booking
        </Button>
      </div>
    </Dialog>
  );
}
