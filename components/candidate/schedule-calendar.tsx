"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventInput } from "@fullcalendar/core";
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Clock, ExternalLink, Pencil, TrendingUp } from "lucide-react";

import { CalendarSettings } from "@/components/calendar-settings";
import { TimezonePicker } from "@/components/timezone-picker";
import { EditDetailsDialog } from "@/components/candidate/edit-details-dialog";
import { RescheduleDialog } from "@/components/candidate/reschedule-dialog";
import { NextStageDialog } from "@/components/candidate/request-next-stage";
import { useCalendarHeight } from "@/lib/use-calendar-height";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDataChanged } from "@/lib/bus";
import { type CalendarPrefs, DEFAULT_PREFS, hourStr, loadPrefs, savePrefs, timeFormat } from "@/lib/calendar-prefs";
import { colorBg } from "@/lib/colors";
import { FORMAT_LABEL, type TypeStyleMap, typeStyle } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InterviewRequest } from "@/lib/types";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending: { bg: "rgba(245,158,11,0.2)", border: "#f59e0b", text: "#fbbf24" },
  approved: { bg: "rgba(16,185,129,0.2)", border: "#10b981", text: "#6ee7b7" },
  scheduled: { bg: "rgba(99,102,241,0.28)", border: "#6366f1", text: "#c7d2fe" },
  completed: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.25)", text: "rgba(255,255,255,0.6)" },
  cancelled: { bg: "rgba(239,68,68,0.14)", border: "#ef4444", text: "#fca5a5" },
  rejected: { bg: "rgba(239,68,68,0.14)", border: "#ef4444", text: "#fca5a5" },
};

const VIEWS = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
];

export function ScheduleCalendar({
  userId,
  timezone,
  initial,
}: {
  userId: string;
  timezone: string;
  initial: InterviewRequest[];
}) {
  const { toast } = useToast();
  const calRef = useRef<FullCalendar>(null);
  const calHeight = useCalendarHeight(240);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("dayGridMonth");
  const [rows, setRows] = useState<InterviewRequest[]>(initial);
  const [detail, setDetail] = useState<InterviewRequest | null>(null);
  const [editing, setEditing] = useState<InterviewRequest | null>(null);
  const [reschedule, setReschedule] = useState<InterviewRequest | null>(null);
  const [nextStage, setNextStage] = useState<InterviewRequest | null>(null);
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_PREFS);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const [typeStyles, setTypeStyles] = useState<TypeStyleMap>({});

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("app_settings").select("interview_type_styles").eq("id", 1).maybeSingle();
      setTypeStyles((data as { interview_type_styles?: TypeStyleMap } | null)?.interview_type_styles ?? {});
    })();
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("interview_requests")
      .select("*")
      .eq("candidate_id", userId)
      .order("created_at", { ascending: false });
    if (data) setRows(data as InterviewRequest[]);
  }, [userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`cand-schedule-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests", filter: `candidate_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);
  useDataChanged("interviews", load);

  const events = useMemo<EventInput[]>(() => {
    const out: EventInput[] = [];
    for (const r of rows) {
      if (prefs.hiddenStatuses.includes(r.status)) continue;
      const at = r.scheduled_at || r.preferred_at;
      if (!at) continue;
      const start = new Date(at);
      if (range) {
        const endMs = start.getTime() + (r.duration_minutes || 30) * 60000;
        if (endMs < range.start || start.getTime() > range.end) continue;
      }
      const c = COLORS[r.status] ?? COLORS.pending;
      const ts = typeStyle(r.interview_type, typeStyles);
      const solid = r.status === "approved" || r.status === "scheduled";
      const dead = r.status === "cancelled" || r.status === "rejected";
      const done = r.status === "completed";
      // Precedence: manual per-request color → interview-type color → status color.
      // Cancelled is forced to slate so RED stays unique to "rejected".
      const accent =
        r.status === "cancelled" ? "#94a3b8" : (r.color ?? (r.interview_type ? ts.color : null) ?? c.border);
      out.push({
        id: r.id,
        title: r.role,
        start,
        end: new Date(start.getTime() + (r.duration_minutes || 30) * 60000),
        backgroundColor: solid ? accent : colorBg(accent, done ? 0.14 : 0.18),
        borderColor: accent,
        textColor: solid ? "#ffffff" : c.text,
        // Solid = confirmed (pop); dashed = pending; dim = completed; struck = dead.
        classNames: [solid ? "ev-pop" : r.status === "pending" ? "ev-tentative" : done ? "ev-dim" : dead ? "ev-dead" : ""],
        // Only a confirmed interview can be dragged to propose a new time.
        editable: r.status === "scheduled" && !!r.scheduled_at,
        extendedProps: {
          reqId: r.id,
          emoji: ts.emoji,
          typeLabel: r.interview_type ?? null,
          statusLabel: r.status,
        },
      });
    }
    return out;
  }, [rows, prefs.hiddenStatuses, range, typeStyles]);

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
          <h2 className="text-sm font-medium text-[#f0f0f5]">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-[#13131a] p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => {
                  api()?.changeView(v.value);
                  setView(v.value);
                }}
                className={cn("rounded-md px-2.5 py-1 text-[12px] font-medium", view === v.value ? "bg-[#6366f1]/[0.16] text-[#c7d2fe]" : "text-white/50 hover:text-white/80")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <TimezonePicker
            value={prefs.timeZone}
            onChange={(tz) => { const next = { ...prefs, timeZone: tz }; setPrefs(next); savePrefs(next); }}
          />
          <CalendarSettings value={prefs} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
          <Link href="/candidate/book">
            <Button size="sm"><CalendarPlus className="h-4 w-4" /> Book</Button>
          </Link>
        </div>
      </div>

      <Card className="cand-cal p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView={prefs.scheduleView}
            timeZone={prefs.timeZone}
            headerToolbar={false}
            height={calHeight}
            expandRows
            slotEventOverlap={false}
            eventMinHeight={28}
            eventShortHeight={40}
            allDaySlot={false}
            nowIndicator
            dayMaxEvents={3}
            editable
            eventStartEditable
            eventDurationEditable={false}
            slotLabelInterval="01:00:00"
            views={{ timeGrid: { dayHeaderFormat: { weekday: "short", day: "numeric" } } }}
            snapDuration="00:05:00"
            eventDrop={async (info) => {
              const start = info.event.start;
              if (!start || start.getTime() <= Date.now()) {
                toast({ title: "Pick a future time", variant: "error" });
                info.revert();
                return;
              }
              const when = formatInTimeZone(start.toISOString(), prefs.timeZone);
              if (!window.confirm(`Propose moving this interview to ${when}? Your interviewer will confirm it.`)) {
                info.revert();
                return;
              }
              const supabase = createClient();
              const { error } = await supabase.rpc("propose_reschedule", {
                p_interview_id: String(info.event.id),
                p_at: start.toISOString(),
              });
              // A drag is only a PROPOSAL (candidates can't move a confirmed time directly);
              // revert the block to its real slot until the admin accepts.
              info.revert();
              if (error) toast({ title: "Couldn't propose", description: error.message, variant: "error" });
              else toast({ title: "New time proposed", description: "Your interviewer will review it.", variant: "success" });
            }}
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(prefs.dayStart)}
            slotMaxTime={hourStr(prefs.dayEnd)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
            eventContent={(arg) => {
              const p = arg.event.extendedProps as {
                emoji?: string;
                typeLabel?: string | null;
                statusLabel?: string;
              };
              const sub = [arg.timeText, p.typeLabel || p.statusLabel].filter(Boolean).join(" · ");
              return (
                <div className="fc-chip">
                  <div className="fc-chip-title">
                    {p.emoji ? `${p.emoji} ` : ""}
                    {arg.event.title}
                  </div>
                  {sub ? <div className="fc-chip-time">{sub}</div> : null}
                </div>
              );
            }}
            datesSet={(arg) => {
              setTitle(arg.view.title);
              setView(arg.view.type);
              setRange({ start: arg.start.getTime(), end: arg.end.getTime() });
              setPrefs((p) => {
                if (p.scheduleView === arg.view.type) return p;
                const next = { ...p, scheduleView: arg.view.type };
                savePrefs(next);
                return next;
              });
            }}
            eventClick={(info) => {
              const r = rows.find((x) => x.id === info.event.extendedProps.reqId);
              if (r) setDetail(r);
            }}
          />
        ) : (
          <div className="animate-pulse rounded-lg bg-white/[0.02]" style={{ height: calHeight }} />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px] text-white/45">
        <span className="text-white/30">Filter:</span>
        {[
          { s: "pending", l: "Pending" },
          { s: "approved", l: "Approved" },
          { s: "scheduled", l: "Scheduled" },
          { s: "completed", l: "Completed" },
          { s: "cancelled", l: "Cancelled" },
          { s: "rejected", l: "Rejected" },
        ].map((x) => {
          const hidden = prefs.hiddenStatuses.includes(x.s);
          return (
            <button
              key={x.s}
              type="button"
              onClick={() => {
                const next = {
                  ...prefs,
                  hiddenStatuses: hidden
                    ? prefs.hiddenStatuses.filter((s) => s !== x.s)
                    : [...prefs.hiddenStatuses, x.s],
                };
                setPrefs(next);
                savePrefs(next);
              }}
              title={hidden ? `Show ${x.l.toLowerCase()}` : `Hide ${x.l.toLowerCase()}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors hover:bg-white/[0.06]",
                hidden && "opacity-40",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: (COLORS[x.s] ?? COLORS.cancelled).border }} />
              <span className={cn(hidden && "line-through")}>{x.l}</span>
            </button>
          );
        })}
        <span className="text-white/30">· Times in {prefs.timeZone === "local" ? timezone : prefs.timeZone}</span>
      </div>

      {detail ? (
        <Dialog open onClose={() => setDetail(null)} title={detail.role} description={detail.interview_type ?? undefined}>
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              {detail.format ? <Badge tone="slate">{FORMAT_LABEL[detail.format] ?? detail.format}</Badge> : null}
              <Badge tone={detail.payment_status === "paid" ? "green" : "amber"}>{detail.payment_status}</Badge>
            </div>
            {detail.company ? (
              <p className="text-white/75">
                <span className="text-white/40">Company:</span> {detail.company}
              </p>
            ) : null}
            {detail.interviewer_name ? (
              <p className="text-white/75">
                <span className="text-white/40">Interviewer:</span> {detail.interviewer_name}
              </p>
            ) : null}
            <p className="flex items-center gap-2 text-white/75">
              <Clock className="h-4 w-4 text-white/40" />
              {detail.scheduled_at
                ? formatInTimeZone(detail.scheduled_at, timezone)
                : `${formatInTimeZone(detail.preferred_at, timezone)} (requested)`}
              {" · "}
              {detail.duration_minutes} min
            </p>
            {detail.status === "scheduled" && detail.meeting_link ? (
              <a href={detail.meeting_link} target="_blank" rel="noreferrer">
                <Button size="sm"><ExternalLink className="h-4 w-4" /> Join meeting</Button>
              </a>
            ) : null}
            {detail.notes ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/40">Notes</p>
                <p className="whitespace-pre-wrap text-white/75">{detail.notes}</p>
              </div>
            ) : null}
            {(() => {
              // Rejected is included: a declined interview can be re-worked
              // (edit the details, propose a new time) rather than re-booked.
              const canEdit = ["pending", "approved", "scheduled", "rejected"].includes(detail.status);
              const canReschedule = ["approved", "scheduled", "rejected"].includes(detail.status);
              // A passed (completed) interview can kick off the next round.
              const canNextStage = detail.status === "completed";
              if (!canEdit && !canReschedule && !canNextStage) return null;
              return (
                <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.06] pt-3">
                  {canNextStage ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setNextStage(detail);
                        setDetail(null);
                      }}
                    >
                      <TrendingUp className="h-4 w-4" /> Request next stage
                    </Button>
                  ) : null}
                  {canReschedule ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReschedule(detail);
                        setDetail(null);
                      }}
                    >
                      <CalendarClock className="h-4 w-4" /> Reschedule
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(detail);
                        setDetail(null);
                      }}
                    >
                      <Pencil className="h-4 w-4" /> Edit details
                    </Button>
                  ) : null}
                </div>
              );
            })()}
          </div>
        </Dialog>
      ) : null}
      {editing ? (
        <EditDetailsDialog request={editing} userId={userId} onClose={() => setEditing(null)} />
      ) : null}
      {reschedule ? (
        <RescheduleDialog request={reschedule} timezone={timezone} onClose={() => setReschedule(null)} />
      ) : null}
      {nextStage ? (
        <NextStageDialog previous={nextStage} userId={userId} timezone={timezone} onClose={() => setNextStage(null)} />
      ) : null}
    </div>
  );
}
