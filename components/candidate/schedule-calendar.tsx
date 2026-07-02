"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventInput } from "@fullcalendar/core";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, ExternalLink } from "lucide-react";

import { CalendarSettings } from "@/components/calendar-settings";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useDataChanged } from "@/lib/bus";
import { type CalendarPrefs, DEFAULT_PREFS, hourStr, loadPrefs, savePrefs, timeFormat } from "@/lib/calendar-prefs";
import { colorBg } from "@/lib/colors";
import { FORMAT_LABEL } from "@/lib/interview";
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
  const calRef = useRef<FullCalendar>(null);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("dayGridMonth");
  const [rows, setRows] = useState<InterviewRequest[]>(initial);
  const [detail, setDetail] = useState<InterviewRequest | null>(null);
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
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
      const at = r.scheduled_at || r.preferred_at;
      if (!at) continue;
      const start = new Date(at);
      const c = COLORS[r.status] ?? COLORS.pending;
      out.push({
        id: r.id,
        title: `${r.role} · ${r.status}`,
        start,
        end: new Date(start.getTime() + (r.duration_minutes || 30) * 60000),
        backgroundColor: r.color ? colorBg(r.color, 0.3) : c.bg,
        borderColor: r.color ?? c.border,
        textColor: c.text,
        extendedProps: { reqId: r.id },
      });
    }
    return out;
  }, [rows]);

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
          <CalendarSettings value={prefs} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
          <Link href="/candidate/book">
            <Button size="sm"><CalendarPlus className="h-4 w-4" /> Book</Button>
          </Link>
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            height={640}
            allDaySlot={false}
            nowIndicator
            dayMaxEvents={3}
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(prefs.dayStart)}
            slotMaxTime={hourStr(prefs.dayEnd)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
            datesSet={(arg) => {
              setTitle(arg.view.title);
              setView(arg.view.type);
            }}
            eventClick={(info) => {
              const r = rows.find((x) => x.id === info.event.extendedProps.reqId);
              if (r) setDetail(r);
            }}
          />
        ) : (
          <div className="h-[640px] animate-pulse rounded-lg bg-white/[0.02]" />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-white/45">
        {[
          { s: "pending", l: "Pending" },
          { s: "approved", l: "Approved" },
          { s: "scheduled", l: "Scheduled" },
          { s: "completed", l: "Completed" },
        ].map((x) => (
          <span key={x.s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[x.s].border }} /> {x.l}
          </span>
        ))}
        <span className="text-white/30">· Times in {timezone}</span>
      </div>

      {detail ? (
        <Dialog open onClose={() => setDetail(null)} title={detail.role} description={detail.interview_type ?? undefined}>
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone[detail.status] ?? "slate"}>{detail.status}</Badge>
              {detail.format ? <Badge tone="slate">{FORMAT_LABEL[detail.format] ?? detail.format}</Badge> : null}
              <Badge tone={detail.payment_status === "paid" ? "green" : "amber"}>{detail.payment_status}</Badge>
            </div>
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
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
