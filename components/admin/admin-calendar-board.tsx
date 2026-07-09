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
import { useCalendarHeight } from "@/lib/use-calendar-height";
import { colorBg } from "@/lib/colors";
import { type TypeStyleMap, typeStyle } from "@/lib/interview";
import { statusColor, statusLabel } from "@/lib/status";
import { useStatusSettings } from "@/lib/use-status-settings";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";
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
// "status" entries take their color/label from the admin's status settings.
const LEGEND: Array<{ key: string; kind: "status" | "slot"; color?: string; label?: string }> = [
  { key: "pending", kind: "status" },
  { key: "approved", kind: "status" },
  { key: "scheduled", kind: "status" },
  { key: "completed", kind: "status" },
  { key: "available", kind: "slot", color: "rgba(16,185,129,0.45)", label: "Available" },
  { key: "busy", kind: "slot", color: "rgba(255,255,255,0.3)", label: "Blocked" },
  { key: "event", kind: "slot", color: "#8b5cf6", label: "Event" },
];

const DAY = 86400000;

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

/** Shift a datetime-local wall-clock string by N minutes while staying in `tz`. */
function shiftWall(wall: string, minutes: number, tz: string): string {
  const ms = new Date(wallTimeToUtcISO(wall, tz)).getTime() + minutes * 60000;
  return utcToLocalInput(new Date(ms).toISOString(), tz);
}

/** Google-Calendar-style event body: the role title, then who, then the time.
 *  Slots fall back to FullCalendar's default rendering (return undefined). */
function renderEventContent(arg: {
  timeText: string;
  event: { extendedProps: Record<string, unknown> };
  view?: { type?: string };
}) {
  const p = arg.event.extendedProps as {
    kind?: string;
    emoji?: string;
    role?: string;
    person?: string;
    adminMinutes?: number;
  };
  // Only customize the grid views; the Agenda (list) view has its own layout.
  if (p.kind !== "interview" || arg.view?.type?.startsWith("list")) return undefined;
  return (
    <div className="fc-iv-content">
      <div className="fc-iv-title">
        {p.emoji ?? ""} {p.role}
      </div>
      <div className="fc-iv-mins">⏱ {p.adminMinutes ?? 0} min</div>
      <div className="fc-iv-person">{p.person}</div>
      {arg.timeText ? <div className="fc-iv-time">{arg.timeText}</div> : null}
    </div>
  );
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
  const { labels: statusLabels, colors: statusColors } = useStatusSettings();
  const calendarRef = useRef<FullCalendar>(null);
  // Admin has a header toolbar + a legend row below the grid, so reserve a bit more.
  const calHeight = useCalendarHeight(260);
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
  // Google-Calendar-style hover card with the interview's full details.
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    role: string;
    person: string;
    emoji: string;
    when: string;
    durationMin: number;
    adminMinutes: number;
    statusLabel: string;
    interviewType: string | null;
    hasLink: boolean;
    color: string;
  } | null>(null);
  // Resolve the calendar's display zone. By default ("local") the calendar
  // follows the admin's account timezone (Settings → Your timezone) so a single
  // setting drives every date in the app; picking a specific zone in the
  // toolbar overrides it just for this view.
  const realTz =
    prefs.timeZone === "local"
      ? adminTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : prefs.timeZone;

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
  // Right-click context menu (delete an interview or a free/busy time block).
  const [ctx, setCtx] = useState<{ x: number; y: number; kind: string; id: string; label: string } | null>(null);
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
    const prevColor = profiles.find((p) => p.id === id)?.calendar_color ?? null;
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, calendar_color: color } : p)));
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ calendar_color: color }).eq("id", id);
    if (error) {
      // Revert so the UI matches what actually persisted (and don't fail silently).
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, calendar_color: prevColor } : p)));
      toast({ title: "Couldn't save color", description: error.message, variant: "error" });
    }
  }, [profiles, toast]);

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
    const nowMs = Date.now();
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
      const ts = typeStyle(r.interview_type, typeStyles);
      // Fill/border = status color (admin-configurable). A scheduled interview
      // whose time has passed shows in the "completed" color.
      const effStatus = r.status === "scheduled" && end.getTime() < nowMs ? "completed" : r.status;
      const sc = statusColor(effStatus, statusColors);
      // The per-person color (set in the People list) is kept as a left-edge
      // stripe — see eventDidMount.
      const personColor = userColors[r.candidate_id] ?? r.color ?? null;
      const person = candName(r.candidate_id);
      out.push({
        id: `iv:${r.id}`,
        title: `${ts.emoji} ${r.role} · ${person}`,
        start,
        end,
        editable: r.status === "scheduled",
        backgroundColor: colorBg(sc, 0.24),
        borderColor: sc,
        textColor: "#f4f4f8",
        classNames: r.status === "pending" ? ["fc-iv", "fc-pending-req"] : ["fc-iv"],
        extendedProps: {
          kind: "interview",
          requestId: r.id,
          role: r.role,
          person,
          emoji: ts.emoji,
          statusLabel: statusLabel(effStatus, statusLabels),
          durationMin: r.duration_minutes ?? 30,
          // Admin-set custom minutes shown on the block — 0 until the admin sets it.
          adminMinutes: r.actual_minutes ?? 0,
          startMs: start.getTime(),
          interviewType: r.interview_type ?? null,
          hasLink: Boolean(r.meeting_link),
          personColor,
        },
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
            editable: true, // drag/resize any block; recurring edits shift the whole series
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
  }, [requests, slots, range, candName, prefs.hiddenStatuses, hiddenUsers, userColors, typeStyles, statusColors, statusLabels]);

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
    // Default to the top of the next hour, expressed in the calendar's zone.
    const nowWall = utcToLocalInput(new Date().toISOString(), realTz);
    const start = shiftWall(`${nowWall.slice(0, 13)}:00`, 60, realTz);
    setAdd({ type, start, end: shiftWall(start, 60, realTz) });
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
    // FullCalendar hands us real instants; express them as wall-clock in the
    // calendar's display zone so the Add dialog matches the cell that was clicked.
    let start = utcToLocalInput(arg.start.toISOString(), realTz);
    let end = utcToLocalInput(arg.end.toISOString(), realTz);
    if (arg.allDay) {
      // An all-day selection carries no time — default to a 9am, one-hour slot.
      start = `${start.slice(0, 10)}T09:00`;
      end = shiftWall(start, 60, realTz);
    }
    setAdd({ type: "available", start, end });
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

  // Right-click on any event → offer a quick Delete.
  const onEventContext = (arg: { jsEvent: MouseEvent; event: { extendedProps: Record<string, unknown>; title: string } }) => {
    arg.jsEvent.preventDefault();
    const kind = arg.event.extendedProps.kind as string;
    const id = (kind === "interview" ? arg.event.extendedProps.requestId : arg.event.extendedProps.slotId) as string;
    if (!id) return;
    setCtx({
      x: arg.jsEvent.clientX,
      y: arg.jsEvent.clientY,
      kind,
      id,
      label: kind === "interview" ? "Delete interview" : "Delete this time block",
    });
  };

  // Deleting an interview is destructive (cascades the Google event + notifies the
  // candidate), so it keeps a confirm. Slots use soft-delete + Undo instead.
  async function deleteInterviewFromCtx() {
    if (!ctx) return;
    const supabase = createClient();
    const r = requests.find((x) => x.id === ctx.id);
    if (r) {
      await supabase.from("notifications").insert({
        user_id: r.candidate_id,
        title: "Interview removed",
        detail: `Your interview for "${r.role}" was removed by the admin.`,
        type: "alert",
      });
    }
    const { error } = await supabase.from("interview_requests").delete().eq("id", ctx.id);
    setCtx(null);
    if (error) return toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    toast({ title: "Interview deleted", variant: "success" });
    load();
  }

  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: adminTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso),
    );

  function undoSlots(rows: AvailabilitySlot[]) {
    toast({
      title: rows.length === 1 ? "Time block removed" : `Cleared ${rows.length} blocks`,
      variant: "success",
      action: {
        label: "Undo",
        onClick: async () => {
          const supabase = createClient();
          await supabase.from("availability_slots").insert(rows);
          load();
        },
      },
    });
  }

  async function deleteSlotFromCtx() {
    if (!ctx) return;
    const row = slots.find((s) => s.id === ctx.id);
    setCtx(null);
    const supabase = createClient();
    const { error } = await supabase.from("availability_slots").delete().eq("id", ctx.id);
    if (error) return toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    if (row) undoSlots([row]);
    load();
  }

  async function clearDayFromCtx() {
    if (!ctx) return;
    const anchor = slots.find((s) => s.id === ctx.id);
    setCtx(null);
    if (!anchor) return;
    // One-off blocks on the same calendar day (recurring series are left alone).
    const key = dayKey(anchor.starts_at);
    const rows = slots.filter((s) => s.repeat_rule === "none" && dayKey(s.starts_at) === key);
    if (!rows.length) return;
    const supabase = createClient();
    const { error } = await supabase.from("availability_slots").delete().in("id", rows.map((s) => s.id));
    if (error) return toast({ title: "Couldn't clear the day", description: error.message, variant: "error" });
    undoSlots(rows);
    load();
  }
  const onEventChange = (arg: {
    event: { start: Date | null; end: Date | null; extendedProps: Record<string, unknown> };
    oldEvent?: { start: Date | null; end: Date | null };
    revert: () => void;
  }) => {
    const kind = arg.event.extendedProps.kind;
    // Dragging / resizing an availability (or busy/event) block updates its time.
    if (kind === "slot") {
      const slotId = arg.event.extendedProps.slotId as string;
      const slot = slots.find((s) => s.id === slotId);
      if (!slot || !arg.event.start || !arg.event.end) {
        arg.revert();
        return;
      }
      let startISO: string;
      let endISO: string;
      const recurring = slot.repeat_rule === "daily" || slot.repeat_rule === "weekly";
      if (recurring) {
        // Shift the anchor by the same delta as the dragged occurrence, so the
        // whole series moves/resizes together (editing the recurring template).
        const oldS = arg.oldEvent?.start?.getTime();
        const oldE = arg.oldEvent?.end?.getTime();
        if (oldS == null || oldE == null) {
          arg.revert();
          return;
        }
        startISO = new Date(new Date(slot.starts_at).getTime() + (arg.event.start.getTime() - oldS)).toISOString();
        endISO = new Date(new Date(slot.ends_at).getTime() + (arg.event.end.getTime() - oldE)).toISOString();
      } else {
        startISO = arg.event.start.toISOString();
        endISO = arg.event.end.toISOString();
      }
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
          toast({ title: recurring ? "Recurring block updated (whole series)" : "Availability updated", variant: "success" });
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
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
            title={prefs.timeZone === "local" ? `Following your account timezone (${realTz})` : prefs.timeZone}
          >
            {tzLabel(realTz)}
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
          <div className="gcal-cal" style={{ ["--slh"]: `${(prefs.zoom ?? 1) * 5.2}em` } as CSSProperties}>
            <style>{`
              .gcal-cal .fc-timegrid-slot{height:var(--slh)!important}
              .gcal-cal .fc-pending-req{border-style:dashed!important;border-width:2px!important;}
              /* Fill the full slot: no inset gap on the right, snug to the grid lines. */
              .gcal-cal .fc-timegrid-event-harness{inset-inline-end:0!important}
              .gcal-cal .fc-timegrid-event{margin:0!important}
              /* Tight chrome so narrow week-view blocks keep as much text width as possible. */
              .gcal-cal .fc-iv{border-left-width:2px;padding:2px 5px}
              .gcal-cal .fc-iv-content{display:flex;flex-direction:column;gap:1px;line-height:1.18;overflow:hidden;height:100%;justify-content:flex-start}
              .gcal-cal .fc-iv-title{font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
              .gcal-cal .fc-iv-person{font-size:11px;font-weight:500;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
              .gcal-cal .fc-iv-time{font-size:10.5px;font-weight:600;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
              /* Admin-set custom minutes — its own line right under the title so
                 it's always visible; content is top-aligned (see fc-iv-content)
                 so any overflow trims the lower person/time lines, never the
                 title or minutes. */
              .gcal-cal .fc-iv-mins{font-size:10.5px;font-weight:700;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
              /* Cramped events: keep only the title + minutes; drop person & time. */
              .gcal-cal .fc-timegrid-event-short .fc-iv-content{gap:0}
              .gcal-cal .fc-timegrid-event-short .fc-iv-title{-webkit-line-clamp:1}
              .gcal-cal .fc-timegrid-event-short .fc-iv-person{display:none}
              .gcal-cal .fc-timegrid-event-short .fc-iv-time{display:none}
            `}</style>
            {mounted ? (
              <FullCalendar
                ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            initialView="timeGridWeek"
            timeZone={realTz}
            headerToolbar={false}
            height={calHeight}
            nowIndicator
            selectable
            selectMirror
            editable
            eventResizableFromStart
            slotEventOverlap={false}
            /* Give short interviews enough height for title + minutes + person +
               time so they don't clip (the block's "length", per the request). */
            eventMinHeight={74}
            eventShortHeight={48}
            slotDuration="00:30:00"
            snapDuration="00:05:00"
            dayMaxEvents={3}
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(hourBounds.lo)}
            slotMaxTime={hourStr(hourBounds.hi)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            /* Show only the start time on blocks — the end-time range was long and
               truncated ("9:30 PM -…") in narrow week columns; the minutes line
               and block height already convey the length. */
            displayEventEnd={false}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={onEventChange}
            eventResize={onEventChange}
            eventContent={renderEventContent}
            eventMouseEnter={(info) => {
              const p = info.event.extendedProps;
              if (p?.kind !== "interview") return;
              setHover({
                x: info.jsEvent.clientX,
                y: info.jsEvent.clientY,
                role: p.role,
                person: p.person,
                emoji: p.emoji,
                when: formatInTimeZone(new Date(p.startMs).toISOString(), realTz),
                durationMin: p.durationMin,
                adminMinutes: p.adminMinutes ?? 0,
                statusLabel: p.statusLabel,
                interviewType: p.interviewType,
                hasLink: p.hasLink,
                color: info.event.borderColor || "#6366f1",
              });
            }}
            eventMouseLeave={() => setHover(null)}
            eventDidMount={(info) => {
              info.el.addEventListener("contextmenu", (e) =>
                onEventContext({ jsEvent: e as MouseEvent, event: info.event }),
              );
              // Per-person color as a Google-Calendar-style left stripe.
              const pc = info.event.extendedProps?.personColor;
              if (info.event.extendedProps?.kind === "interview" && pc) {
                info.el.style.borderLeftColor = pc;
                info.el.style.borderLeftWidth = "4px";
              }
            }}
              />
            ) : (
              <div className="animate-pulse rounded-lg bg-white/[0.02]" style={{ height: calHeight }} />
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[12px] text-white/50">
        <span className="text-white/30">Show:</span>
        {LEGEND.map((l) => {
          const hidden = prefs.hiddenStatuses.includes(l.key);
          const color = l.kind === "status" ? statusColor(l.key, statusColors) : l.color;
          const label = l.kind === "status" ? statusLabel(l.key, statusLabels) : l.label;
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
              title={hidden ? `Show ${label}` : `Hide ${label}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors hover:bg-white/[0.06]",
                hidden && "opacity-40",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
              <span className={cn(hidden && "line-through")}>{label}</span>
            </button>
          );
        })}
        <span className="text-white/30">· Times in {prefs.timeZone === "local" ? "your local zone" : prefs.timeZone}</span>
      </div>

      <p className="px-1 text-[12px] text-white/40">
        Tip: <span className="text-white/60">drag across the grid</span> to add availability, and{" "}
        <span className="text-white/60">drag a block&apos;s edge</span> to resize or move it — no typing needed.
      </p>

      {hover ? (
        <div
          className="pointer-events-none fixed z-[120] w-72 rounded-xl border border-white/10 bg-[#15151d] p-3.5 shadow-2xl"
          style={{
            left: Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
            top: Math.min(hover.y + 14, (typeof window !== "undefined" ? window.innerHeight : 800) - 200),
          }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: hover.color }} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-[#f0f0f5]">
                {hover.emoji} {hover.role}
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-white/60">{hover.person}</p>
            </div>
          </div>
          <div className="mt-2.5 space-y-1 text-[12.5px] text-white/70">
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-white/40" />
              {hover.when} · {hover.durationMin} min
              <span className="text-white/45">· set {hover.adminMinutes} min</span>
            </p>
            <p className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize"
                style={{ backgroundColor: colorBg(hover.color, 0.18), color: hover.color }}
              >
                {hover.statusLabel}
              </span>
              {hover.interviewType ? <span className="text-white/45">· {hover.interviewType}</span> : null}
            </p>
            {hover.hasLink ? (
              <p className="flex items-center gap-1.5 text-[#a5b4fc]">
                <ExternalLink className="h-3.5 w-3.5" /> Meeting link attached
              </p>
            ) : null}
          </div>
          <p className="mt-2.5 border-t border-white/[0.06] pt-2 text-[11px] text-white/35">Click to manage · right-click for actions</p>
        </div>
      ) : null}

      {add ? (
        <AddSlotDialog
          adminId={adminId}
          profiles={profiles}
          preset={add}
          tz={realTz}
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

      {ctx ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div
            className="fixed z-50 min-w-[210px] overflow-hidden rounded-lg border border-white/10 bg-[#13131a] py-1 shadow-xl"
            style={{ left: Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 230), top: ctx.y }}
          >
            {ctx.kind === "interview" ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this interview? This can't be undone.")) deleteInterviewFromCtx();
                  else setCtx(null);
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#f87171] hover:bg-white/[0.06]"
              >
                <Trash2 className="h-4 w-4" /> Delete interview
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={deleteSlotFromCtx}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06]"
                >
                  <Trash2 className="h-4 w-4" /> Delete this time block
                </button>
                <button
                  type="button"
                  onClick={clearDayFromCtx}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#f87171] hover:bg-white/[0.06]"
                >
                  <Trash2 className="h-4 w-4" /> Clear all one-off blocks this day
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddSlotDialog({
  adminId,
  profiles,
  preset,
  tz,
  onClose,
  onDone,
}: {
  adminId: string;
  profiles: ProfileLite[];
  preset: { type: string; start: string; end: string };
  tz: string;
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
      starts_at: wallTimeToUtcISO(start, tz),
      ends_at: wallTimeToUtcISO(end, tz),
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
        <p className="-mt-2 text-[11px] text-white/35">Times in {tz}.</p>
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
  const [saving, setSaving] = useState(false);
  const [startInput, setStartInput] = useState(() => utcToLocalInput(slot.starts_at, adminTimezone));
  const [endInput, setEndInput] = useState(() => utcToLocalInput(slot.ends_at, adminTimezone));
  const tone = slot.slot_type === "available" ? "green" : slot.slot_type === "event" ? "purple" : "slate";
  const repeatLabel = slot.repeat_rule === "daily" ? "Every day" : slot.repeat_rule === "weekly" ? "Every week" : "One-time";
  const recurring = slot.repeat_rule !== "none";

  async function saveTimes() {
    const startISO = wallTimeToUtcISO(startInput, adminTimezone);
    const endISO = wallTimeToUtcISO(endInput, adminTimezone);
    if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
      toast({ title: "End must be after start", variant: "error" });
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("availability_slots")
      .update({ starts_at: startISO, ends_at: endISO })
      .eq("id", slot.id);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "error" });
      return;
    }
    toast({ title: recurring ? "Times updated (whole series)" : "Times updated", variant: "success" });
    onDone();
    onClose();
  }

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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" htmlFor="sd-start">
            <Input id="sd-start" type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
          </Field>
          <Field label="Ends" htmlFor="sd-end">
            <Input id="sd-end" type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/40">
            Times in {adminTimezone}.{recurring ? " Editing changes the whole series." : ""}
          </span>
          <Button size="sm" loading={saving} onClick={saveTimes}>
            Save times
          </Button>
        </div>
        <dl className="space-y-2.5 text-[13px]">
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
    const { error } = await supabase.rpc("schedule_interview", {
      p_interview_id: move.request.id,
      p_scheduled_at: move.startISO,
      p_duration: move.durationMin,
      p_meeting_link: null, // keep the existing link
      p_interviewer_id: move.request.interviewer_id,
    });
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
