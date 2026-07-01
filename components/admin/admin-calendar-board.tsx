"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import {
  Ban,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";

import { ManageRequestDialog } from "@/components/admin/manage-request-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged, useDataChanged } from "@/lib/bus";
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

const LEGEND = [
  { color: "#f59e0b", label: "Pending" },
  { color: "#10b981", label: "Approved" },
  { color: "#6366f1", label: "Scheduled" },
  { color: "rgba(255,255,255,0.3)", label: "Completed" },
  { color: "rgba(16,185,129,0.45)", label: "Available" },
  { color: "rgba(255,255,255,0.3)", label: "Blocked" },
  { color: "#8b5cf6", label: "Event" },
];

const DAY = 86400000;

function pad(n: number) {
  return String(n).padStart(2, "0");
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
  const [manageRequest, setManageRequest] = useState<InterviewRequest | null>(null);
  const [slotDetail, setSlotDetail] = useState<AvailabilitySlot | null>(null);
  const [move, setMove] = useState<{
    request: InterviewRequest;
    startISO: string;
    durationMin: number;
    revert: () => void;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  const candidates = useMemo(() => {
    const map: Record<string, CandidateLite> = {};
    for (const p of profiles) map[p.id] = { full_name: p.full_name, email: p.email, timezone: p.timezone };
    return map;
  }, [profiles]);
  const candName = useCallback(
    (id: string | null) => (id ? candidates[id]?.full_name || candidates[id]?.email || "Candidate" : "Candidate"),
    [candidates],
  );

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: reqs }, { data: sl }, { data: profs }] = await Promise.all([
      supabase.from("interview_requests").select("*"),
      supabase.from("availability_slots").select("*"),
      supabase.from("profiles").select("id, full_name, email, timezone, role, created_at"),
    ]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (sl) setSlots(sl as AvailabilitySlot[]);
    if (profs) setProfiles(profs as ProfileLite[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-calendar-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "availability_slots" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);
  useDataChanged("interviews", load);

  const events = useMemo<EventInput[]>(() => {
    const out: EventInput[] = [];
    for (const r of requests) {
      if (r.status === "cancelled" || r.status === "rejected") continue;
      const at = r.scheduled_at ?? r.preferred_at;
      if (!at) continue;
      const start = new Date(at);
      const end = new Date(start.getTime() + (r.duration_minutes ?? 30) * 60000);
      const style = INTERVIEW_STYLES[r.status] ?? INTERVIEW_STYLES.pending;
      out.push({
        id: `iv:${r.id}`,
        title: `${candName(r.candidate_id)} · ${r.role}${r.status !== "scheduled" ? ` (${r.status})` : ""}`,
        start,
        end,
        editable: r.status === "scheduled",
        backgroundColor: style.bg,
        borderColor: style.border,
        textColor: style.text,
        extendedProps: { kind: "interview", requestId: r.id },
      });
    }
    if (range) {
      for (const s of slots) {
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
  }, [requests, slots, range, candName]);

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
          <Button size="sm" variant="secondary" onClick={() => openAdd("busy")}>
            <Ban className="h-4 w-4" /> Block
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openAdd("event")}>
            <CalendarPlus className="h-4 w-4" /> Event
          </Button>
          <Button size="sm" onClick={() => openAdd("available")}>
            <Plus className="h-4 w-4" /> Availability
          </Button>
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={false}
            height={660}
            nowIndicator
            selectable
            selectMirror
            editable
            eventResizableFromStart
            dayMaxEvents={3}
            scrollTime="08:00:00"
            eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
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
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[12px] text-white/50">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.label}
          </span>
        ))}
        <span className="text-white/30">· Times shown in your local timezone</span>
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
