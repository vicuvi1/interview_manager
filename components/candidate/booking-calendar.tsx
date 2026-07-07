"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventInput } from "@fullcalendar/core";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";

import { CalendarSettings } from "@/components/calendar-settings";
import { TimezonePicker } from "@/components/timezone-picker";
import { useCalendarHeight } from "@/lib/use-calendar-height";
import { AttachmentsField } from "@/components/candidate/attachments-field";
import { InterviewRequestForm } from "@/components/candidate/interview-request-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type CalendarPrefs, DEFAULT_PREFS, hourStr, loadPrefs, savePrefs, timeFormat } from "@/lib/calendar-prefs";
import { type TypeStyleMap, typeStyle } from "@/lib/interview";
import { expandRecurring } from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Attachment, CandidateMaterials } from "@/lib/types";

interface BookingRules {
  min_notice_hours: number;
  booking_horizon_days: number;
}

interface Range {
  starts_at: string;
  ends_at: string;
  repeat_rule?: string;
}
interface Availability {
  available: Range[];
  busy: Range[];
  taken: { starts_at: string; ends_at: string }[];
}
interface MyRow {
  id: string;
  role: string;
  status: string;
  scheduled_at: string | null;
  preferred_at: string | null;
  duration_minutes: number;
  meeting_link: string | null;
  interview_type: string | null;
  attachments: Attachment[] | null;
}

const ms = (iso: string) => new Date(iso).getTime();

const MINE_TONE: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "rgba(99,102,241,0.28)", border: "#6366f1", text: "#c7d2fe" },
  pending: { bg: "rgba(245,158,11,0.22)", border: "#f59e0b", text: "#fbbf24" },
  approved: { bg: "rgba(16,185,129,0.22)", border: "#10b981", text: "#6ee7b7" },
  completed: { bg: "rgba(148,163,184,0.22)", border: "#64748b", text: "#e2e8f0" },
  cancelled: { bg: "rgba(148,163,184,0.16)", border: "#94a3b8", text: "#cbd5e1" },
  rejected: { bg: "rgba(239,68,68,0.16)", border: "#ef4444", text: "#fca5a5" },
};

export function BookingCalendar({
  userId,
  timezone,
  materials,
}: {
  userId: string;
  timezone: string;
  materials: CandidateMaterials;
}) {
  const { toast } = useToast();
  const calRef = useRef<FullCalendar>(null);
  const rangeRef = useRef<{ start: number; end: number } | null>(null);
  const calHeight = useCalendarHeight(240);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("timeGridWeek");
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [mine, setMine] = useState<MyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ startISO: string; dur: number; busy?: boolean; instant?: boolean } | null>(null);
  const [busyAsk, setBusyAsk] = useState<{ startISO: string; dur: number } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: MyRow } | null>(null);
  const [detail, setDetail] = useState<MyRow | null>(null);
  const [editWhen, setEditWhen] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [rules, setRules] = useState<BookingRules>({ min_notice_hours: 0, booking_horizon_days: 0 });
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_PREFS);
  const [typeStyles, setTypeStyles] = useState<TypeStyleMap>({});

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("min_notice_hours, booking_horizon_days, interview_type_styles")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setRules({ min_notice_hours: data.min_notice_hours ?? 0, booking_horizon_days: data.booking_horizon_days ?? 0 });
        setTypeStyles((data.interview_type_styles as TypeStyleMap) ?? {});
      }
    })();
  }, []);

  /** Returns an error message if the chosen start violates the admin's booking rules. */
  const ruleViolation = useCallback(
    (startMs: number): string | null => {
      const now = Date.now();
      if (rules.min_notice_hours > 0 && startMs < now + rules.min_notice_hours * 3600_000) {
        return `Please book at least ${rules.min_notice_hours} hour${rules.min_notice_hours === 1 ? "" : "s"} in advance.`;
      }
      if (rules.booking_horizon_days > 0 && startMs > now + rules.booking_horizon_days * 86400_000) {
        return `You can only book up to ${rules.booking_horizon_days} day${rules.booking_horizon_days === 1 ? "" : "s"} ahead.`;
      }
      return null;
    },
    [rules],
  );

  async function proposeEdit() {
    if (!detail || !editWhen) return;
    setSavingEdit(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("propose_reschedule", {
      p_interview_id: detail.id,
      p_at: wallTimeToUtcISO(editWhen, timezone),
    });
    setSavingEdit(false);
    if (error) {
      toast({ title: "Couldn't send", description: error.message, variant: "error" });
      return;
    }
    toast({ title: "New time sent to the admin", description: "They'll review and confirm it.", variant: "success" });
    setDetail(null);
    setEditWhen("");
    const r = rangeRef.current;
    if (r) load(r.start, r.end);
  }

  const load = useCallback(async (from: number, to: number) => {
    setLoading(true);
    const supabase = createClient();
    const [{ data }, { data: mineRows }] = await Promise.all([
      supabase.rpc("get_booking_availability", {
        p_from: new Date(from).toISOString(),
        p_to: new Date(to).toISOString(),
      }),
      supabase
        .from("interview_requests")
        .select("id, role, status, scheduled_at, preferred_at, duration_minutes, meeting_link, interview_type, attachments")
        .eq("candidate_id", userId),
    ]);
    setAvail((data as Availability) ?? { available: [], busy: [], taken: [] });
    setMine((mineRows as MyRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  // Live-refresh when the admin edits availability/blocks or an interview changes,
  // so the green "available" / red "busy" bands update without a page reload.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const r = rangeRef.current;
        if (r) load(r.start, r.end);
      }, 300);
    };
    const channel = supabase
      .channel(`cand-booking-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests", filter: `candidate_id=eq.${userId}` }, reload)
      .subscribe();
    // Poll for other users' bookings becoming busy — RLS hides their rows from realtime.
    const poll = window.setInterval(() => {
      const r = rangeRef.current;
      if (r) load(r.start, r.end);
    }, 60_000);
    return () => {
      if (t) clearTimeout(t);
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  // Busy + already-taken intervals in the visible window — also used to detect
  // when a candidate is asking for a time the admin marked unavailable.
  const blockedIntervals = useMemo(() => {
    if (!avail || !range) return [] as { s: number; e: number }[];
    return [
      ...avail.busy.flatMap((b) => expandRecurring(ms(b.starts_at), ms(b.ends_at), b.repeat_rule ?? "none", range.start, range.end)),
      ...avail.taken.map((t) => ({ s: ms(t.starts_at), e: ms(t.ends_at) })),
    ];
  }, [avail, range]);

  const overlapsBusy = useCallback(
    (s: number, e: number) => blockedIntervals.some((b) => s < b.e && b.s < e),
    [blockedIntervals],
  );

  // The admin's published "available" windows in the visible range.
  const availIntervals = useMemo(() => {
    if (!avail || !range) return [] as { s: number; e: number }[];
    return avail.available.flatMap((a) =>
      expandRecurring(ms(a.starts_at), ms(a.ends_at), a.repeat_rule ?? "none", range.start, range.end),
    );
  }, [avail, range]);

  // True when [s,e) is fully inside a published available window → bookable instantly.
  const insideAvailable = useCallback(
    (s: number, e: number) => availIntervals.some((iv) => s >= iv.s && e <= iv.e),
    [availIntervals],
  );

  const events = useMemo<EventInput[]>(() => {
    if (!avail || !range) return [];
    const availIvals = availIntervals;
    const blocked = blockedIntervals;
    const now = Date.now();
    const out: EventInput[] = [];

    // GREEN "Available" = the admin's free/bookable windows.
    for (const iv of availIvals) {
      if (iv.e <= now) continue;
      out.push({
        id: `av-${iv.s}-${iv.e}`,
        title: "Available",
        start: new Date(Math.max(iv.s, now)),
        end: new Date(iv.e),
        display: "background",
        classNames: ["fc-free-slot"],
      });
    }

    // RED "Busy" = blocked time + already-booked (drawn on top). You can still
    // request these — the admin decides.
    for (const b of blocked) {
      out.push({
        id: `blk-${b.s}-${b.e}`,
        title: "Busy",
        start: new Date(b.s),
        end: new Date(b.e),
        display: "background",
        classNames: ["fc-busy-block"],
      });
    }

    // The candidate's own requests/interviews (all statuses render — rejected /
    // cancelled show as struck-through ghosts and are click-through so they never
    // block picking that slot again).
    for (const r of mine) {
      const at = r.scheduled_at || r.preferred_at;
      if (!at) continue;
      const s = ms(at);
      const e = s + (r.duration_minutes || 30) * 60000;
      if (e < range.start || s > range.end) continue;
      out.push({
        id: `mine-${r.id}`,
        title: `${typeStyle(r.interview_type, typeStyles).emoji} ${r.role}`,
        start: new Date(s),
        end: new Date(e),
        classNames: [`mine-${r.status}`],
        // Drag an active interview onto free time to propose a new slot.
        editable: (r.status === "scheduled" || r.status === "approved") && s > now,
        extendedProps: { own: true, rowId: r.id, dur: Math.round((e - s) / 60000) },
      });
    }
    return out;
  }, [avail, range, mine, typeStyles, blockedIntervals, availIntervals]);

  const api = () => calRef.current?.getApi();
  const nav = (d: "prev" | "next" | "today") => {
    const a = api();
    if (!a) return;
    if (d === "prev") a.prev();
    else if (d === "next") a.next();
    else a.today();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-white/10 bg-[#13131a]">
            <button type="button" onClick={() => nav("prev")} className="flex h-9 w-9 items-center justify-center rounded-l-lg text-white/50 hover:bg-white/[0.06] hover:text-white/80" aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => nav("today")} className="border-x border-white/10 px-3 text-[13px] font-medium text-white/70 hover:bg-white/[0.06]">Today</button>
            <button type="button" onClick={() => nav("next")} className="flex h-9 w-9 items-center justify-center rounded-r-lg text-white/50 hover:bg-white/[0.06] hover:text-white/80" aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <h2 className="text-[15px] font-semibold text-[#f0f0f5]">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-[#13131a] p-0.5">
            {[
              { v: "timeGridWeek", l: "Week" },
              { v: "timeGridDay", l: "Day" },
            ].map((x) => (
              <button
                key={x.v}
                type="button"
                onClick={() => {
                  api()?.changeView(x.v);
                  setView(x.v);
                }}
                className={cn("rounded-md px-2.5 py-1 text-[12px] font-medium", view === x.v ? "bg-[#6366f1]/[0.16] text-[#c7d2fe]" : "text-white/50 hover:text-white/80")}
              >
                {x.l}
              </button>
            ))}
          </div>
          <TimezonePicker
            value={prefs.timeZone}
            onChange={(tz) => { const next = { ...prefs, timeZone: tz }; setPrefs(next); savePrefs(next); }}
          />
          <CalendarSettings value={prefs} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 px-1 text-[12px] text-white/50">
        {[
          { c: "#10b981", l: "Available" },
          { c: "#ef4444", l: "Busy" },
          { c: "#f59e0b", l: "Your requests" },
          { c: "#6366f1", l: "Scheduled" },
        ].map((x) => (
          <span key={x.l} className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: x.c }} />
            {x.l}
          </span>
        ))}
      </div>

      <Card className="cand-cal p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calRef}
            plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView={prefs.bookingView}
            timeZone={prefs.timeZone}
            headerToolbar={false}
            height={calHeight}
            expandRows
            slotEventOverlap={false}
            eventMinHeight={28}
            eventShortHeight={40}
            allDaySlot={false}
            nowIndicator
            selectable
            selectMirror
            editable
            eventStartEditable
            eventDurationEditable={false}
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            dayHeaderFormat={{ weekday: "short", day: "numeric" }}
            snapDuration="00:05:00"
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(prefs.dayStart)}
            slotMaxTime={hourStr(prefs.dayEnd)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
            eventContent={(arg) => {
              // Availability/Busy bands keep FullCalendar's default background render.
              if (arg.event.display === "background") return undefined;
              return (
                <div className="fc-chip">
                  <div className="fc-chip-title">{arg.event.title}</div>
                  {arg.timeText ? <div className="fc-chip-time">{arg.timeText}</div> : null}
                </div>
              );
            }}
            datesSet={(arg) => {
              rangeRef.current = { start: arg.start.getTime(), end: arg.end.getTime() };
              setRange({ start: arg.start.getTime(), end: arg.end.getTime() });
              setTitle(arg.view.title);
              setView(arg.view.type);
              load(arg.start.getTime(), arg.end.getTime());
              setPrefs((p) => {
                if (p.bookingView === arg.view.type) return p;
                const next = { ...p, bookingView: arg.view.type };
                savePrefs(next);
                return next;
              });
            }}
            eventClick={(info) => {
              const p = info.event.extendedProps as { startISO?: string; dur?: number; rowId?: string };
              if (p.rowId) {
                const row = mine.find((m) => m.id === p.rowId);
                if (row) setDetail(row);
              } else if (p.startISO) {
                setSelected({ startISO: p.startISO, dur: p.dur ?? 30 });
              }
            }}
            eventDidMount={(info) => {
              const p = info.event.extendedProps as { own?: boolean; rowId?: string };
              if (!p.own || !p.rowId) return;
              info.el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                const row = mine.find((m) => m.id === p.rowId);
                if (row) setCtx({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, row });
              });
            }}
            eventDrop={async (info) => {
              const start = info.event.start;
              if (!start || start.getTime() <= Date.now()) {
                toast({ title: "Pick a future time", variant: "info" });
                info.revert();
                return;
              }
              const durMin = (info.event.extendedProps as { dur?: number }).dur ?? 30;
              // Enforce dropping onto free time (not a busy/blocked band).
              if (overlapsBusy(start.getTime(), start.getTime() + durMin * 60000)) {
                toast({ title: "That time is busy", description: "Drop the interview on a free slot.", variant: "info" });
                info.revert();
                return;
              }
              const when = formatInTimeZone(start.toISOString(), prefs.timeZone);
              if (!window.confirm(`Propose moving this interview to ${when}? Your interviewer will confirm it.`)) {
                info.revert();
                return;
              }
              const supabase = createClient();
              const rowId = String(info.event.id).replace(/^mine-/, "");
              const { error } = await supabase.rpc("propose_reschedule", { p_interview_id: rowId, p_at: start.toISOString() });
              // Proposal only — revert to the current slot until the admin accepts.
              info.revert();
              if (error) toast({ title: "Couldn't propose", description: error.message, variant: "error" });
              else toast({ title: "New time proposed", description: "Your interviewer will review it.", variant: "success" });
            }}
            select={(info) => {
              api()?.unselect();
              if (info.start.getTime() < Date.now()) return;
              const violation = ruleViolation(info.start.getTime());
              if (violation) {
                toast({ title: "Can't book that time", description: violation, variant: "info" });
                return;
              }
              const durMin = Math.max(5, Math.round((info.end.getTime() - info.start.getTime()) / 60000));
              // If the time overlaps a busy/blocked band, ask before requesting an exception.
              if (overlapsBusy(info.start.getTime(), info.end.getTime())) {
                setBusyAsk({ startISO: info.start.toISOString(), dur: durMin });
                return;
              }
              // Inside a published "Available" window → book instantly; otherwise request-and-wait.
              const instant = insideAvailable(info.start.getTime(), info.end.getTime());
              setSelected({ startISO: info.start.toISOString(), dur: durMin, instant });
            }}
          />
        ) : (
          <div className="animate-pulse rounded-lg bg-white/[0.02]" style={{ height: calHeight }} />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-white/45">
        {loading ? (
          <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading times…</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-[#a5b4fc]" />
            <span className="text-white/70">Drag over a green (available) time to book it instantly</span> — other times become a request the admin confirms. Drag an existing interview onto a free slot to propose a new time.
          </span>
        )}
      </div>

      {busyAsk ? (
        <Dialog
          open
          onClose={() => setBusyAsk(null)}
          title="That time looks busy"
          description={formatInTimeZone(busyAsk.startISO, timezone)}
        >
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-white/70">
              The admin is marked <span className="font-medium text-[#fca5a5]">busy</span> at this time. Want to ask them
              to make an exception anyway? They&apos;ll get your request and can accept or decline — if they accept, this
              time becomes your confirmed interview.
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  setSelected({ startISO: busyAsk.startISO, dur: busyAsk.dur, busy: true });
                  setBusyAsk(null);
                }}
              >
                Ask the admin anyway
              </Button>
              <Button variant="ghost" onClick={() => setBusyAsk(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {selected ? (
        <Dialog
          open
          onClose={() => setSelected(null)}
          title={selected.busy ? "Request a busy time" : selected.instant ? "Book this time" : "Request this time"}
          description={`${formatInTimeZone(selected.startISO, timezone)} · ${selected.dur} min`}
        >
          {selected.busy ? (
            <div className="mb-4 rounded-lg border border-[#f59e0b]/25 bg-[#f59e0b]/[0.08] px-3.5 py-2.5 text-[12px] text-[#fbbf24]">
              You&apos;re asking for a time the admin marked busy — they&apos;ll decide whether to make an exception.
            </div>
          ) : selected.instant ? (
            <div className="mb-4 rounded-lg border border-[#10b981]/25 bg-[#10b981]/[0.08] px-3.5 py-2.5 text-[12px] text-[#6ee7b7]">
              This time is open — it&apos;ll be <span className="font-medium">confirmed instantly</span> when you submit.
            </div>
          ) : null}
          <InterviewRequestForm
            userId={userId}
            timezone={timezone}
            materials={materials}
            fixedStart={{ iso: selected.startISO, durationMin: selected.dur }}
            busyOverride={selected.busy}
            instantBook={selected.instant}
            onDone={() => {
              setSelected(null);
              if (range) load(range.start, range.end);
            }}
          />
        </Dialog>
      ) : null}

      {ctx ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[190px] overflow-hidden rounded-lg border border-white/10 bg-[#13131a] py-1 shadow-xl"
            style={{ left: Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 210), top: ctx.y }}
          >
            <button
              type="button"
              onClick={() => {
                setDetail(ctx.row);
                setCtx(null);
              }}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06]"
            >
              <Pencil className="h-4 w-4" /> View / edit details
            </button>
            {["pending", "approved", "scheduled"].includes(ctx.row.status) ? (
              <button
                type="button"
                onClick={async () => {
                  const row = ctx.row;
                  setCtx(null);
                  if (!window.confirm(`Cancel your interview for "${row.role}"?`)) return;
                  const supabase = createClient();
                  const { error } = await supabase.rpc("cancel_my_request", { p_interview_id: row.id });
                  if (error) toast({ title: "Couldn't cancel", description: error.message, variant: "error" });
                  else {
                    toast({ title: "Interview cancelled", variant: "success" });
                    if (range) load(range.start, range.end);
                  }
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#f87171] hover:bg-white/[0.06]"
              >
                <Trash2 className="h-4 w-4" /> Cancel interview
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {detail ? (
        <Dialog open onClose={() => { setDetail(null); setEditWhen(""); }} title={detail.role} description={detail.interview_type ?? "Your interview"}>
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[12px] font-medium capitalize"
                style={{
                  backgroundColor: (MINE_TONE[detail.status] ?? MINE_TONE.pending).bg,
                  color: (MINE_TONE[detail.status] ?? MINE_TONE.pending).text,
                }}
              >
                {detail.status}
              </span>
              <span className="text-white/50">{detail.duration_minutes} min</span>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/40">
                {detail.scheduled_at ? "Scheduled" : "Requested time"}
              </p>
              <p className="mt-0.5 font-medium text-[#f0f0f5]">
                {formatInTimeZone(detail.scheduled_at ?? detail.preferred_at, timezone)}
              </p>
            </div>
            {detail.meeting_link ? (
              <a
                href={detail.meeting_link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#5457e5]"
              >
                Join meeting
              </a>
            ) : (
              <p className="text-[12px] text-white/40">
                {detail.status === "pending"
                  ? "Waiting for the admin to confirm this time."
                  : "The meeting link will appear here once it's added."}
              </p>
            )}
            {detail.attachments && detail.attachments.length ? (
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Attachments</p>
                <AttachmentsField userId={userId} value={detail.attachments} readOnly />
              </div>
            ) : null}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[12px] font-medium text-white/70">Need a different time?</p>
              <p className="mb-2 text-[11px] text-white/40">Pick a new time and we&apos;ll send it to the admin to confirm.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="datetime-local"
                  value={editWhen}
                  onChange={(e) => setEditWhen(e.target.value)}
                  className="h-9 flex-1"
                  aria-label="New time"
                />
                <Button size="sm" loading={savingEdit} disabled={savingEdit || !editWhen} onClick={proposeEdit}>
                  Send to admin
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-white/35">
              You can also cancel or leave notes from <span className="text-white/60">My interviews</span>.
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
