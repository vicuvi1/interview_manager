"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventInput } from "@fullcalendar/core";
import {
  Ban,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";

import { CalendarPeople } from "@/components/admin/calendar-people";
import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { MiniMonth } from "@/components/admin/mini-month";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
import { type CalendarPrefs, DEFAULT_PREFS, hourStr, loadPrefs, savePrefs, timeFormat } from "@/lib/calendar-prefs";
import { CalendarSettings } from "@/components/calendar-settings";
import { TimezonePicker } from "@/components/timezone-picker";
import { colorBg } from "@/lib/colors";
import { type TypeStyleMap, typeStyle } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type {
  AvailabilitySlot,
  CandidateLite,
  InterviewRequest,
  ProfileLite,
} from "@/lib/types";

const VIEWS = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
  { value: "listWeek", label: "Agenda" },
] as const;

const INTERVIEW_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "rgba(99,102,241,0.18)", border: "#6366f1", text: "#c7d2fe" },
  completed: { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.2)", text: "rgba(255,255,255,0.6)" },
  cancelled: { bg: "rgba(239,68,68,0.14)", border: "#ef4444", text: "#fca5a5" },
  pending: { bg: "rgba(245,158,11,0.2)", border: "#f59e0b", text: "#fbbf24" },
  approved: { bg: "rgba(16,185,129,0.18)", border: "#10b981", text: "#6ee7b7" },
};

const SLOT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  available: { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.45)", text: "#6ee7b7" },
  busy: { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.18)", text: "rgba(255,255,255,0.55)" },
  event: { bg: "rgba(139,92,246,0.16)", border: "#8b5cf6", text: "#ddd6fe" },
};

const SLOT_LABEL: Record<string, string> = {
  available: "Available",
  busy: "Blocked",
  event: "Event",
};

// key = interview status OR slot_type; used for the clickable filter legend.
const LEGEND = [
  { key: "pending", color: "#f59e0b", label: "Pending" },
  { key: "approved", color: "#10b981", label: "Approved" },
  { key: "scheduled", color: "#6366f1", label: "Scheduled" },
  { key: "completed", color: "rgba(255,255,255,0.3)", label: "Completed" },
  { key: "available", color: "rgba(16,185,129,0.45)", label: "Available" },
  { key: "busy", color: "rgba(255,255,255,0.3)", label: "Blocked" },
  { key: "event", color: "#8b5cf6", label: "Event" },
];

const DAY = 86400000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A short GMT-offset label for a timezone (e.g. "GMT+3"), like Google Calendar. */
function tzLabel(tz: string): string {
  try {
    const zone = tz === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || zone;
  } catch {
    return tz === "local" ? "Local" : tz;
  }
}

/** Format a JS Date as a datetime-local input value in the browser's timezone. */
function dateToLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Expand a (possibly recurring) slot into concrete occurrences within a range. */
function expandRecurring(
  anchorStart: number,
  anchorEnd: number,
  rule: string,
  rangeStart: number,
  rangeEnd: number,
): Array<{ s: number; e: number }> {
  const duration = Math.max(0, anchorEnd - anchorStart);
  if (rule !== "daily" && rule !== "weekly") {
    if (anchorEnd >= rangeStart && anchorStart <= rangeEnd) return [{ s: anchorStart, e: anchorEnd }];
    return [];
  }
  const interval = rule === "daily" ? DAY : 7 * DAY;
  const out: Array<{ s: number; e: number }> = [];
  let k = Math.max(0, Math.floor((rangeStart - anchorEnd) / interval));
  for (let i = 0; i < 400; i++, k++) {
    const s = anchorStart + k * interval;
    if (s > rangeEnd) break;
    const e = s + duration;
    if (e >= rangeStart) out.push({ s, e });
  }
  return out;
}

export function AdminCalendarBoard({
  adminId,
  adminTimezone,
  initialRequests,
  initialSlots,
  initialProfiles,
}: {
  adminId: string;
  adminTimezone: string;
  initialRequests: InterviewRequest[];
  initialSlots: AvailabilitySlot[];
  initialProfiles: ProfileLite[];
}) {
  const { toast } = useToast();
  const calendarRef = useRef<FullCalendar>(null);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<string>("timeGridWeek");
  const [title, setTitle] = useState("");
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initialSlots);
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialProfiles);

  const [add, setAdd] = useState<{ type: string; start: string; end: string } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_PREFS);
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());

  const savePref = (patch: Partial<CalendarPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  };
  const setZoom = (z: number) => savePref({ zoom: Math.max(0.6, Math.min(2.5, Math.round(z * 10) / 10)) });
  const [manageRequest, setManageRequest] = useState<InterviewRequest | null>(null);
  const [slotDetail, setSlotDetail] = useState<AvailabilitySlot | null>(null);
  const [move, setMove] = useState<{
    request: InterviewRequest;
    startISO: string;
    durationMin: number;
    revert: () => void;
  } | null>(null);

  const [typeStyles, setTypeStyles] = useState<TypeStyleMap>({});

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
    try {
      const raw = window.localStorage.getItem("admin-cal-hidden-users");
      if (raw) setHiddenUsers(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("app_settings").select("interview_type_styles").eq("id", 1).maybeSingle();
      setTypeStyles((data as { interview_type_styles?: TypeStyleMap } | null)?.interview_type_styles ?? {});
    })();
  }, []);

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = useCallback(
    (id: string | null) => (id ? candidates[id]?.full_name || candidates[id]?.email || "Candidate" : "Candidate"),
    [candidates],
  );

  // Per-user (candidate) calendar colors, Google-style.
  const userColors = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of profiles) map[p.id] = p.calendar_color ?? null;
    return map;
  }, [profiles]);

  // The candidate "calendars" list: everyone who has an interview.
  const people = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) if (r.candidate_id) ids.add(r.candidate_id);
    return Array.from(ids)
      .map((id) => ({ id, name: candName(id), color: userColors[id] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, candName, userColors]);

  const toggleUser = useCallback((id: string) => {
    setHiddenUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem("admin-cal-hidden-users", JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setUserColor = useCallback(async (id: string, color: string | null) => {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, calendar_color: color } : p)));
    const supabase = createClient();
    await supabase.from("profiles").update({ calendar_color: color }).eq("id", id);
  }, []);

  const gotoDate = useCallback((d: Date) => calendarRef.current?.getApi()?.gotoDate(d), []);

  const persistHidden = (next: Set<string>) => {
    try {
      window.localStorage.setItem("admin-cal-hidden-users", JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
  };
  const showAllUsers = useCallback(() => {
    setHiddenUsers(() => {
      persistHidden(new Set());
      return new Set();
    });
  }, []);
  const hideAllUsers = useCallback(() => {
    setHiddenUsers(() => {
      const next = new Set(people.map((p) => p.id));
      persistHidden(next);
      return next;
    });
  }, [people]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: sl }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*"),
      supabase.from("availability_slots").select("*"),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at, calendar_color"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (sl) setSlots(sl as AvailabilitySlot[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  useEffect(() => {
    // Initial data comes from server props; only refetch on live changes,
    // debounced so a burst of updates triggers a single reload.
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (t) clearTimeout(t);
      t = setTimeout(load, 300);
    };
    const supabase = createClient();
    const channel = supabase
      .channel("admin-calendar-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "availability_slots" }, debounced)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [load]);
  useDataChanged("interviews", load);

  const events = useMemo<EventInput[]>(() => {
    const out: EventInput[] = [];
    for (const r of requests) {
      if (r.status === "cancelled" || r.status === "rejected") continue;
      if (prefs.hiddenStatuses.includes(r.status)) continue;
      if (hiddenUsers.has(r.candidate_id)) continue; // person's calendar toggled off
      const at = r.scheduled_at ?? r.preferred_at;
      if (!at) continue;
      const start = new Date(at);
      const end = new Date(start.getTime() + (r.duration_minutes ?? 30) * 60000);
      // Only feed FullCalendar events in the visible window — keeps it light.
      if (range && (end.getTime() < range.start || start.getTime() > range.end)) continue;
      const style = INTERVIEW_STYLES[r.status] ?? INTERVIEW_STYLES.pending;
      const ts = typeStyle(r.interview_type, typeStyles);
      // Color priority: per-request tag → per-user calendar color → interview-type color → status.
      const tint = r.color ?? userColors[r.candidate_id] ?? (r.interview_type ? ts.color : null);
      out.push({
        id: `iv:${r.id}`,
        title: `${ts.emoji} ${candName(r.candidate_id)} · ${r.role}${r.status !== "scheduled" ? ` (${r.status})` : ""}`,
        start,
        end,
        editable: r.status === "scheduled",
        backgroundColor: tint ? colorBg(tint, 0.32) : style.bg,
        borderColor: tint ?? style.border,
        textColor: style.text,
        classNames: r.status === "pending" ? ["fc-pending-req"] : undefined,
        extendedProps: { kind: "interview", requestId: r.id },
      });
    }
    if (range) {
      for (const s of slots) {
        if (prefs.hiddenStatuses.includes(s.slot_type)) continue;
        const style = SLOT_STYLES[s.slot_type] ?? SLOT_STYLES.event;
        const occ = expandRecurring(
          new Date(s.starts_at).getTime(),
          new Date(s.ends_at).getTime(),
          s.repeat_rule,
          range.start,
          range.end,
        );
        occ.forEach((o, i) => {
          out.push({
            id: `sl:${s.id}:${i}`,
            title: s.title || SLOT_LABEL[s.slot_type] || "Blocked",
            start: new Date(o.s),
            end: new Date(o.e),
            editable: s.repeat_rule === "none", // one-off blocks can be dragged/resized
            backgroundColor: style.bg,
            borderColor: style.border,
            textColor: style.text,
            classNames: s.slot_type === "busy" ? ["fc-busy-slot"] : [],
            extendedProps: { kind: "slot", slotId: s.id },
          });
        });
      }
    }
    return out;
  }, [requests, slots, range, candName, prefs.hiddenStatuses, hiddenUsers, userColors, typeStyles]);

  // Auto-expand the visible hours so no request is ever clipped by the day range,
  // while respecting the gear's day-start/end as a minimum window.
  const hourBounds = useMemo(() => {
    let lo = prefs.dayStart;
    let hi = prefs.dayEnd;
    for (const e of events) {
      const s = e.start instanceof Date ? e.start : new Date(e.start as string);
      const en = e.end instanceof Date ? e.end : new Date((e.end as string) ?? s);
      lo = Math.min(lo, s.getHours());
      hi = Math.max(hi, en.getHours() + (en.getMinutes() > 0 ? 1 : 0));
    }
    lo = Math.max(0, lo);
    hi = Math.min(24, Math.max(hi, lo + 1));
    return { lo, hi };
  }, [events, prefs.dayStart, prefs.dayEnd]);

  const api = () => calendarRef.current?.getApi();
  const nav = (dir: "prev" | "next" | "today") => {
    const a = api();
    if (!a) return;
    if (dir === "prev") a.prev();
    else if (dir === "next") a.next();
    else a.today();
  };
  const changeView = (v: string) => {
    api()?.changeView(v);
    setView(v);
  };

  const openAdd = (type: string) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    setAdd({ type, start: dateToLocalInput(start), end: dateToLocalInput(end) });
  };

  // FullCalendar callbacks — args typed loosely to avoid version-coupled type imports.
  const onDatesSet = (arg: { start: Date; end: Date; view: { title: string; type: string } }) => {
    setRange({ start: arg.start.getTime(), end: arg.end.getTime() });
    setTitle(arg.view.title);
    setView(arg.view.type);
    const d = api()?.getDate();
    if (d) setCurrentDate(d);
  };
  const onSelect = (arg: { start: Date; end: Date; allDay: boolean }) => {
    let start = arg.start;
    let end = arg.end;
    if (arg.allDay) {
      start = new Date(arg.start.getFullYear(), arg.start.getMonth(), arg.start.getDate(), 9, 0);
      end = new Date(start.getTime() + 60 * 60000);
    }
    setAdd({ type: "available", start: dateToLocalInput(start), end: dateToLocalInput(end) });
    api()?.unselect();
  };
  const onEventClick = (arg: { event: { extendedProps: Record<string, unknown> } }) => {
    const kind = arg.event.extendedProps.kind;
    if (kind === "interview") {
      const r = requests.find((x) => x.id === arg.event.extendedProps.requestId);
      if (r) setManageRequest(r);
    } else if (kind === "slot") {
      const s = slots.find((x) => x.id === arg.event.extendedProps.slotId);
      if (s) setSlotDetail(s);
    }
  };
  const onEventChange = (arg: {
    event: { start: Date | null; end: Date | null; extendedProps: Record<string, unknown> };
    revert: () => void;
  }) => {
    const kind = arg.event.extendedProps.kind;
    // Dragging / resizing an availability (or busy/event) block updates its time.
    if (kind === "slot") {
      const slotId = arg.event.extendedProps.slotId as string;
      if (!arg.event.start || !arg.event.end) {
        arg.revert();
        return;
      }
      const startISO = arg.event.start.toISOString();
      const endISO = arg.event.end.toISOString();
      (async () => {
        const supabase = createClient();
        const { error } = await supabase
          .from("availability_slots")
          .update({ starts_at: startISO, ends_at: endISO })
          .eq("id", slotId);
        if (error) {
          toast({ title: "Couldn't update", description: error.message, variant: "error" });
          arg.revert();
        } else {
          toast({ title: "Availability updated", variant: "success" });
        }
        load();
      })();
      return;
    }
    if (kind !== "interview") {
      arg.revert();
      return;
    }
    const r = requests.find((x) => x.id === arg.event.extendedProps.requestId);
    if (!r || !arg.event.start) {
      arg.revert();
      return;
    }
    const start = arg.event.start;
    const end = arg.event.end;
    const durationMin = end
      ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000))
      : r.duration_minutes ?? 30;
    setMove({ request: r, startISO: start.toISOString(), durationMin, revert: arg.revert });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-white/10 bg-[#13131a]">
            <button
              type="button"
              onClick={() => nav("prev")}
              className="flex h-9 w-9 items-center justify-center rounded-l-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nav("today")}
              className="border-x border-white/10 px-3 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/90"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => nav("next")}
              className="flex h-9 w-9 items-center justify-center rounded-r-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <h2 className="text-sm font-medium text-[#f0f0f5]">{title}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-[#13131a] p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => changeView(v.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                  view === v.value
                    ? "bg-[#6366f1]/[0.16] text-[#c7d2fe]"
                    : "text-white/50 hover:text-white/80",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-lg border border-white/10 bg-[#13131a]">
            <button
              type="button"
              onClick={() => setZoom((prefs.zoom ?? 1) - 0.1)}
              className="flex h-9 w-8 items-center justify-center rounded-l-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="border-x border-white/10 px-2 text-[11px] tabular-nums text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/90"
              title="Reset zoom"
            >
              {Math.round((prefs.zoom ?? 1) * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((prefs.zoom ?? 1) + 0.1)}
              className="flex h-9 w-8 items-center justify-center rounded-r-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <span
            className="rounded-lg border border-white/10 bg-[#13131a] px-2.5 py-[7px] text-[11px] font-medium text-white/50"
            title={prefs.timeZone === "local" ? "Your device timezone" : prefs.timeZone}
          >
            {tzLabel(prefs.timeZone)}
          </span>
          <TimezonePicker
            value={prefs.timeZone}
            onChange={(tz) => savePref({ timeZone: tz })}
          />
          <CalendarSettings value={prefs} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
          <Button size="sm" variant="secondary" onClick={() => openAdd("busy")}>
            <Ban className="h-4 w-4" /> Block
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openAdd("event")}>
            <CalendarPlus className="h-4 w-4" /> Event
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setTemplateOpen(true)}>
            <CalendarRange className="h-4 w-4" /> Template
          </Button>
          <Button size="sm" onClick={() => openAdd("available")}>
            <Plus className="h-4 w-4" /> Availability
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="hidden w-56 shrink-0 space-y-4 lg:block">
          <MiniMonth selected={currentDate} weekStart={prefs.weekStart} onPick={gotoDate} />
          <CalendarPeople
            people={people}
            hidden={hiddenUsers}
            onToggle={toggleUser}
            onColor={setUserColor}
            onShowAll={showAllUsers}
            onHideAll={hideAllUsers}
          />
        </aside>
        <Card className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="gcal-cal" style={{ ["--slh"]: `${(prefs.zoom ?? 1) * 1.5}em` } as CSSProperties}>
            <style>{`
              .gcal-cal .fc-timegrid-slot{height:var(--slh)!important}
              .gcal-cal .fc-pending-req{border-style:dashed!important;border-width:2px!important;}
            `}</style>
            {mounted ? (
              <FullCalendar
                ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            initialView="timeGridWeek"
            timeZone={prefs.timeZone}
            headerToolbar={false}
            height={660}
            nowIndicator
            selectable
            selectMirror
            editable
            eventResizableFromStart
            slotDuration="00:30:00"
            snapDuration="00:05:00"
            dayMaxEvents={3}
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(hourBounds.lo)}
            slotMaxTime={hourStr(hourBounds.hi)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={onEventChange}
            eventResize={onEventChange}
              />
            ) : (
              <div className="h-[660px] animate-pulse rounded-lg bg-white/[0.02]" />
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[12px] text-white/50">
        <span className="text-white/30">Show:</span>
        {LEGEND.map((l) => {
          const hidden = prefs.hiddenStatuses.includes(l.key);
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => {
                const next = {
                  ...prefs,
                  hiddenStatuses: hidden
                    ? prefs.hiddenStatuses.filter((s) => s !== l.key)
                    : [...prefs.hiddenStatuses, l.key],
                };
                setPrefs(next);
                savePrefs(next);
              }}
              title={hidden ? `Show ${l.label}` : `Hide ${l.label}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors hover:bg-white/[0.06]",
                hidden && "opacity-40",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
              <span className={cn(hidden && "line-through")}>{l.label}</span>
            </button>
          );
        })}
        <span className="text-white/30">· Times in {prefs.timeZone === "local" ? "your local zone" : prefs.timeZone}</span>
      </div>

      <p className="px-1 text-[12px] text-white/40">
        Tip: <span className="text-white/60">drag across the grid</span> to add availability, and{" "}
        <span className="text-white/60">drag a block&apos;s edge</span> to resize or move it — no typing needed.
      </p>

      {add ? (
        <AddSlotDialog
          adminId={adminId}
          profiles={profiles}
          preset={add}
          onClose={() => setAdd(null)}
          onDone={load}
        />
      ) : null}

      {templateOpen ? (
        <TemplateDialog adminId={adminId} onClose={() => setTemplateOpen(false)} onDone={load} />
      ) : null}

      {slotDetail ? (
        <SlotDetailDialog
          slot={slotDetail}
          candidateName={candName(slotDetail.candidate_id)}
          adminTimezone={adminTimezone}
          onClose={() => setSlotDetail(null)}
          onDone={load}
        />
      ) : null}

      {move ? (
        <RescheduleDialog
          move={move}
          candidateName={candName(move.request.candidate_id)}
          adminTimezone={adminTimezone}
          onCancel={() => {
            move.revert();
            setMove(null);
          }}
          onDone={() => {
            setMove(null);
            load();
          }}
        />
      ) : null}

      {manageRequest ? (
        <ManageRequestDialog
          request={manageRequest}
          candidates={candidates}
          adminTimezone={adminTimezone}
          requests={requests}
          onClose={() => setManageRequest(null)}
        />
      ) : null}
    </div>
  );
}

function AddSlotDialog({
  adminId,
  profiles,
  preset,
  onClose,
  onDone,
}: {
  adminId: string;
  profiles: ProfileLite[];
  preset: { type: string; start: string; end: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const candidatesList = useMemo(() => profiles.filter((p) => p.role !== "admin"), [profiles]);
  const [type, setType] = useState(preset.type);
  const [titleText, setTitleText] = useState("");
  const [start, setStart] = useState(preset.start);
  const [end, setEnd] = useState(preset.end);
  const [repeat, setRepeat] = useState("none");
  const [candidateId, setCandidateId] = useState("");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!start || !end) {
      setError("Pick a start and end time.");
      return;
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      setError("End must be after start.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("availability_slots").insert({
      title: titleText.trim() || null,
      slot_type: type,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      repeat_rule: repeat,
      is_booked: type === "busy",
      candidate_id: type === "event" ? candidateId || null : null,
      meeting_link: type === "event" ? link.trim() || null : null,
      notes: notes.trim() || null,
      created_by: adminId,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    toast({ title: `${SLOT_LABEL[type] ?? "Slot"} added`, variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Add to calendar" description="Availability, a busy block, or an event.">
      <div className="space-y-4">
        <Field label="Type" htmlFor="slot-type">
          <Select id="slot-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="available">Available (bookable)</option>
            <option value="busy">Busy / blocked</option>
            <option value="event">Event</option>
          </Select>
        </Field>
        <Field label="Title" htmlFor="slot-title" hint="Optional label shown on the block.">
          <Input
            id="slot-title"
            placeholder={type === "busy" ? "Lunch, focus time…" : "Office hours…"}
            value={titleText}
            onChange={(e) => setTitleText(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start" htmlFor="slot-start">
            <Input id="slot-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End" htmlFor="slot-end">
            <Input id="slot-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Repeat" htmlFor="slot-repeat">
          <Select id="slot-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </Select>
        </Field>
        {type === "event" ? (
          <>
            <Field label="Candidate" htmlFor="slot-cand" hint="Optional.">
              <Select id="slot-cand" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">— None —</option>
                {candidatesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Meeting link" htmlFor="slot-link" hint="Optional.">
              <Input
                id="slot-link"
                placeholder="https://meet.google.com/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Notes" htmlFor="slot-notes" hint="Optional.">
          <Textarea id="slot-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={save}>
          Add to calendar
        </Button>
      </div>
    </Dialog>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRESETS: { label: string; days: number[] }[] = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekends", days: [0, 6] },
];

function TemplateDialog({
  adminId,
  onClose,
  onDone,
}: {
  adminId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  async function save() {
    if (!days.length) return setError("Pick at least one day.");
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (eh * 60 + em <= sh * 60 + sm) return setError("End time must be after start time.");
    setBusy(true);
    setError(null);

    // For each chosen weekday, anchor to its next occurrence and make it weekly.
    const now = new Date();
    const rows = days.map((d) => {
      const start = new Date(now);
      const delta = (d - now.getDay() + 7) % 7;
      start.setDate(now.getDate() + delta);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(start);
      end.setHours(eh, em, 0, 0);
      return {
        title: "Available",
        slot_type: "available",
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        repeat_rule: "weekly",
        is_booked: false,
        created_by: adminId,
      };
    });

    const supabase = createClient();
    const { error: insertError } = await supabase.from("availability_slots").insert(rows);
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    toast({ title: `Added weekly availability for ${days.length} day${days.length === 1 ? "" : "s"}`, variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Availability template" description="Lay down a repeating weekly schedule in one click.">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-white/55">Quick pick</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setDays(p.days)}
                className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-white/70 transition-colors hover:bg-white/[0.1]"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-white/55">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, d) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(d)}
                className={cn(
                  "h-9 w-11 rounded-lg text-[12px] font-medium transition-colors",
                  days.includes(d) ? "bg-[#6366f1]/20 text-[#c7d2fe] ring-1 ring-inset ring-[#6366f1]/40" : "bg-white/[0.04] text-white/50 hover:text-white/80",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start time" htmlFor="tpl-start">
            <Input id="tpl-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time" htmlFor="tpl-end">
            <Input id="tpl-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
        <p className="text-[11px] text-white/35">Creates a weekly-repeating available block for each selected day.</p>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={save}>
          Add weekly availability
        </Button>
      </div>
    </Dialog>
  );
}

function SlotDetailDialog({
  slot,
  candidateName,
  adminTimezone,
  onClose,
  onDone,
}: {
  slot: AvailabilitySlot;
  candidateName: string;
  adminTimezone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const tone = slot.slot_type === "available" ? "green" : slot.slot_type === "event" ? "purple" : "slate";
  const repeatLabel = slot.repeat_rule === "daily" ? "Every day" : slot.repeat_rule === "weekly" ? "Every week" : "One-time";

  async function remove() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_slots").delete().eq("id", slot.id);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "error" });
      setBusy(false);
      return;
    }
    toast({ title: "Removed from calendar", variant: "success" });
    setBusy(false);
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={slot.title || SLOT_LABEL[slot.slot_type] || "Block"} description={repeatLabel}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{SLOT_LABEL[slot.slot_type] ?? slot.slot_type}</Badge>
          {slot.repeat_rule !== "none" ? <Badge tone="slate">{repeatLabel.toLowerCase()}</Badge> : null}
        </div>
        <dl className="space-y-2.5 text-[13px]">
          <div className="flex items-center gap-2 text-white/70">
            <Clock className="h-4 w-4 text-white/40" />
            {formatInTimeZone(slot.starts_at, adminTimezone)} → {formatInTimeZone(slot.ends_at, adminTimezone)}
          </div>
          {slot.candidate_id ? (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Candidate</dt>
              <dd className="text-white/80">{candidateName}</dd>
            </div>
          ) : null}
          {slot.meeting_link ? (
            <a
              href={slot.meeting_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
            >
              Join meeting <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {slot.notes ? (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-white/40">Notes</dt>
              <dd className="whitespace-pre-wrap text-white/80">{slot.notes}</dd>
            </div>
          ) : null}
        </dl>
        <Button variant="danger" className="w-full" loading={busy} onClick={remove}>
          <Trash2 className="h-4 w-4" /> Remove{slot.repeat_rule !== "none" ? " series" : ""}
        </Button>
      </div>
    </Dialog>
  );
}

function RescheduleDialog({
  move,
  candidateName,
  adminTimezone,
  onCancel,
  onDone,
}: {
  move: { request: InterviewRequest; startISO: string; durationMin: number; revert: () => void };
  candidateName: string;
  adminTimezone: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("interview_requests")
      .update({ scheduled_at: move.startISO, duration_minutes: move.durationMin })
      .eq("id", move.request.id);
    if (error) {
      toast({ title: "Couldn't reschedule", description: error.message, variant: "error" });
      setBusy(false);
      move.revert();
      onDone();
      return;
    }
    if (notify) {
      await supabase.from("notifications").insert({
        user_id: move.request.candidate_id,
        title: "Interview rescheduled",
        detail: `Your interview for "${move.request.role}" was moved to ${formatInTimeZone(move.startISO, adminTimezone)}.`,
        type: "approved",
      });
    }
    toast({ title: "Interview rescheduled", variant: "success" });
    setBusy(false);
    notifyChanged("interviews");
    onDone();
  }

  return (
    <Dialog open onClose={onCancel} title="Move interview" description={`${move.request.role} · ${candidateName}`}>
      <div className="space-y-4">
        <div className="rounded-lg bg-white/[0.03] px-4 py-3 text-[13px]">
          <p className="text-white/55">New time</p>
          <p className="mt-0.5 font-medium text-[#f0f0f5]">{formatInTimeZone(move.startISO, adminTimezone)}</p>
          <p className="mt-0.5 text-[12px] text-white/40">{move.durationMin} minutes</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-white/80">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
          />
          Notify {candidateName} of the change
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" loading={busy} onClick={confirm}>
            Confirm move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
