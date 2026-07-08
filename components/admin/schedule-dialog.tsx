"use client";

import { useCallback, useMemo, useState } from "react";
import { CalendarClock, Check, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { MONTH_NAMES, WEEKDAYS, dateKeyInTimeZone, todayKeyInTimeZone } from "@/lib/calendar";
import { durationOptions } from "@/lib/interview";
import { useDurationSettings } from "@/lib/use-duration-settings";
import { expandRecurring, overlaps, within } from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AvailabilitySlot, CandidateLite, InterviewRequest, ProfileLite } from "@/lib/types";

const START_HOUR = 8;
const END_HOUR = 20;
const STEP_MIN = 30;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function keyToUtc(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(keyToUtc(dateKey) + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function ScheduleDialog({
  request,
  candidate,
  adminTimezone,
  requests,
  slots,
  interviewers = [],
  onClose,
  onDone,
}: {
  request: InterviewRequest;
  candidate: CandidateLite | undefined;
  adminTimezone: string;
  requests: InterviewRequest[];
  slots: AvailabilitySlot[];
  interviewers?: ProfileLite[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { options: durOpts } = useDurationSettings();
  const candTz = candidate?.timezone ?? adminTimezone;

  // The time the candidate originally asked for — used to land the picker on the
  // right day (and pre-select it) instead of making the admin re-navigate there.
  const today = todayKeyInTimeZone(adminTimezone);
  const preferredKey = request.preferred_at ? dateKeyInTimeZone(request.preferred_at, adminTimezone) : null;
  const preferredInWindow = !!preferredKey && preferredKey >= today && preferredKey <= addDaysKey(today, 13);
  const preferredFuture = !!request.preferred_at && new Date(request.preferred_at).getTime() > Date.now();
  const canUsePreferred = preferredInWindow && preferredFuture;

  const [dayKey, setDayKey] = useState(() => (preferredInWindow ? (preferredKey as string) : today));
  const [duration, setDuration] = useState(request.duration_minutes || 30);
  const [selected, setSelected] = useState<string | null>(() => (canUsePreferred ? request.preferred_at : null));
  const [link, setLink] = useState(request.meeting_link ?? "");
  const [interviewerId, setInterviewerId] = useState(request.interviewer_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = todayKeyInTimeZone(adminTimezone);
    return Array.from({ length: 14 }, (_, i) => {
      const key = addDaysKey(start, i);
      const d = new Date(keyToUtc(key));
      return { key, weekday: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTH_NAMES[d.getUTCMonth()].slice(0, 3) };
    });
  }, [adminTimezone]);

  // Availability + blocked intervals for any given day (reused for both the
  // selected-day grid and the cross-day "soonest openings" suggestions).
  const intervalsForDay = useCallback(
    (dk: string) => {
      const dayStart = new Date(wallTimeToUtcISO(`${dk}T00:00`, adminTimezone)).getTime();
      const dayEnd = dayStart + 86400000;
      const availableIvals: Array<{ s: number; e: number }> = [];
      const blockedIvals: Array<{ s: number; e: number }> = [];
      for (const sl of slots) {
        const occ = expandRecurring(
          new Date(sl.starts_at).getTime(),
          new Date(sl.ends_at).getTime(),
          sl.repeat_rule,
          dayStart,
          dayEnd,
        );
        if (sl.slot_type === "available") availableIvals.push(...occ);
        else if (sl.slot_type === "busy") blockedIvals.push(...occ);
      }
      for (const r of requests) {
        if (r.id === request.id || r.status !== "scheduled" || !r.scheduled_at) continue;
        const s = new Date(r.scheduled_at).getTime();
        blockedIvals.push({ s, e: s + (r.duration_minutes ?? 30) * 60000 });
      }
      return { availableIvals, blockedIvals };
    },
    [slots, requests, request.id, adminTimezone],
  );

  // Intervals for the selected day.
  const { availableIvals, blockedIvals } = useMemo(() => intervalsForDay(dayKey), [intervalsForDay, dayKey]);

  const constrained = availableIvals.length > 0;

  const gridSlots = useMemo(() => {
    const out: Array<{ iso: string; label: string; disabled: boolean; reason?: string }> = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      for (let m = 0; m < 60; m += STEP_MIN) {
        const local = `${dayKey}T${pad(h)}:${pad(m)}`;
        const iso = wallTimeToUtcISO(local, adminTimezone);
        const startMs = new Date(iso).getTime();
        const endMs = startMs + duration * 60000;
        if (constrained && !within(startMs, endMs, availableIvals)) continue;
        const clash = blockedIvals.some((iv) => overlaps(startMs, endMs, iv.s, iv.e));
        const past = startMs < Date.now();
        out.push({
          iso,
          label: formatInTimeZone(iso, adminTimezone).split(", ").pop() ?? local,
          disabled: clash || past,
          reason: past ? "past" : clash ? "busy" : undefined,
        });
      }
    }
    return out;
  }, [dayKey, duration, adminTimezone, constrained, availableIvals, blockedIvals]);

  // The soonest few open slots across the upcoming days — one-tap shortcuts so
  // the admin doesn't have to hunt through the grid. At most one per hour to
  // keep the three options spread out.
  const suggestions = useMemo(() => {
    const now = Date.now();
    const out: Array<{ iso: string; label: string }> = [];
    for (const d of days) {
      const { availableIvals: avail, blockedIvals: blocked } = intervalsForDay(d.key);
      const dayConstrained = avail.length > 0;
      for (let h = START_HOUR; h < END_HOUR; h++) {
        for (let m = 0; m < 60; m += STEP_MIN) {
          const iso = wallTimeToUtcISO(`${d.key}T${pad(h)}:${pad(m)}`, adminTimezone);
          const startMs = new Date(iso).getTime();
          const endMs = startMs + duration * 60000;
          if (startMs < now) continue;
          if (dayConstrained && !within(startMs, endMs, avail)) continue;
          if (blocked.some((iv) => overlaps(startMs, endMs, iv.s, iv.e))) continue;
          const time = formatInTimeZone(iso, adminTimezone).split(", ").pop() ?? "";
          out.push({ iso, label: `${d.weekday} ${d.day} · ${time}` });
          break;
        }
        if (out.length >= 3) break;
      }
      if (out.length >= 3) break;
    }
    return out;
  }, [days, intervalsForDay, adminTimezone, duration]);

  async function confirm() {
    if (!selected) {
      setError("Pick a time slot.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Server-side RPC re-validates the slot (admin check + conflict detection
    // under a per-interviewer lock) so the browser grid isn't the only guard.
    const { error: updateError } = await supabase.rpc("schedule_interview", {
      p_interview_id: request.id,
      p_scheduled_at: selected,
      p_duration: duration,
      p_meeting_link: link.trim(),
      p_interviewer_id: interviewerId || null,
    });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    await supabase.from("notifications").insert({
      user_id: request.candidate_id,
      title: "Interview scheduled",
      detail: `Your interview for "${request.role}" is set for ${formatInTimeZone(selected, candTz)}.`,
      type: "approved",
    });
    toast({ title: "Interview scheduled", variant: "success" });
    setBusy(false);
    notifyChanged("interviews");
    onDone();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={request.status === "scheduled" ? "Reschedule interview" : "Schedule interview"}
      description={`${request.role} · ${candidate?.full_name || candidate?.email || "Candidate"}`}
      className="max-w-xl"
    >
      <div className="space-y-4">
        {/* What the candidate asked for */}
        {request.preferred_at ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#6366f1]/25 bg-[#6366f1]/[0.08] px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/40">Candidate asked for</p>
              <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{formatInTimeZone(request.preferred_at, candTz)}</p>
            </div>
            {canUsePreferred ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setDayKey(preferredKey as string);
                  setSelected(request.preferred_at);
                }}
              >
                Use this
              </Button>
            ) : (
              <span className="shrink-0 text-[11px] text-white/35">{preferredFuture ? "outside range" : "in the past"}</span>
            )}
          </div>
        ) : null}

        {/* Soonest openings */}
        {suggestions.length > 0 ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[12px] text-white/50">
              <Sparkles className="h-3.5 w-3.5 text-[#6ee7b7]" /> Soonest openings
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.iso}
                  type="button"
                  onClick={() => {
                    setDayKey(dateKeyInTimeZone(s.iso, adminTimezone));
                    setSelected(s.iso);
                  }}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                    selected === s.iso
                      ? "border-[#6366f1] bg-[#6366f1]/[0.15] text-[#c7d2fe]"
                      : "border-white/10 text-white/70 hover:border-white/20 hover:text-white/90",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Duration */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-white/50">
            {constrained ? (
              <span className="inline-flex items-center gap-1 text-[#6ee7b7]">
                <Sparkles className="h-3.5 w-3.5" /> Showing your available windows
              </span>
            ) : (
              "Default hours — set availability on the calendar to constrain these."
            )}
          </p>
          <div className="w-36">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-9">
              {durationOptions([...durOpts, duration]).map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Day picker */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-thin pb-1">
          {days.map((d) => {
            const active = d.key === dayKey;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setDayKey(d.key);
                  setSelected(null);
                }}
                className={cn(
                  "flex min-w-[52px] shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 transition-colors",
                  active
                    ? "border-[#6366f1] bg-[#6366f1]/[0.12] text-[#c7d2fe]"
                    : "border-white/10 text-white/55 hover:border-white/20 hover:text-white/80",
                )}
              >
                <span className="text-[10px] uppercase tracking-wide opacity-70">{d.weekday}</span>
                <span className="text-[15px] font-semibold leading-tight">{d.day}</span>
                <span className="text-[10px] opacity-60">{d.month}</span>
              </button>
            );
          })}
        </div>

        {/* Slot grid */}
        <div className="max-h-52 overflow-y-auto scrollbar-thin rounded-lg border border-white/[0.06] p-2">
          {gridSlots.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-white/35">
              No open times this day. Try another day{constrained ? " or add availability" : ""}.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {gridSlots.map((s) => {
                const isSel = selected === s.iso;
                return (
                  <button
                    key={s.iso}
                    type="button"
                    disabled={s.disabled}
                    onClick={() => setSelected(s.iso)}
                    className={cn(
                      "rounded-md px-1.5 py-1.5 text-[12px] font-medium tabular-nums transition-colors",
                      s.disabled
                        ? "cursor-not-allowed text-white/20 line-through"
                        : isSel
                          ? "bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white"
                          : "bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white/90",
                    )}
                    title={s.reason === "busy" ? "Conflicts with another block" : s.reason === "past" ? "In the past" : undefined}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected preview */}
        {selected ? (
          <div className="rounded-lg bg-white/[0.03] px-4 py-3 text-[13px]">
            <p className="flex items-center gap-1.5 text-white/80">
              <CalendarClock className="h-4 w-4 text-[#a5b4fc]" />
              You ({adminTimezone}): <span className="font-medium text-[#f0f0f5]">{formatInTimeZone(selected, adminTimezone)}</span>
            </p>
            {candTz !== adminTimezone ? (
              <p className="mt-1 pl-5 text-white/55">
                Candidate ({candTz}): <span className="font-medium text-white/80">{formatInTimeZone(selected, candTz)}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Interviewer */}
        {interviewers.length > 0 ? (
          <Field label="Interviewer" htmlFor="sd-interviewer" hint="Who will run this interview.">
            <Select id="sd-interviewer" value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {interviewers.map((iv) => (
                <option key={iv.id} value={iv.id}>
                  {iv.full_name || iv.email}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {/* Meeting link */}
        <Field label="Meeting link" htmlFor="sd-link" hint="The candidate's link, if they shared one — you can edit it.">
          <Input id="sd-link" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>

        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy || !selected} onClick={confirm}>
          <Check className="h-4 w-4" />
          {request.status === "scheduled" ? "Update time" : "Confirm & notify"}
        </Button>
      </div>
    </Dialog>
  );
}
