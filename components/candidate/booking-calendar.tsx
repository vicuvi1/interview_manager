"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventInput } from "@fullcalendar/core";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { CalendarSettings } from "@/components/calendar-settings";
import { InterviewRequestForm } from "@/components/candidate/interview-request-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type CalendarPrefs, DEFAULT_PREFS, hourStr, loadPrefs, savePrefs, timeFormat } from "@/lib/calendar-prefs";
import { expandRecurring } from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CandidateMaterials } from "@/lib/types";

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
}

const ms = (iso: string) => new Date(iso).getTime();

const MINE_TONE: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "rgba(99,102,241,0.28)", border: "#6366f1", text: "#c7d2fe" },
  pending: { bg: "rgba(245,158,11,0.22)", border: "#f59e0b", text: "#fbbf24" },
  approved: { bg: "rgba(16,185,129,0.22)", border: "#10b981", text: "#6ee7b7" },
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
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("timeGridWeek");
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [mine, setMine] = useState<MyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ startISO: string; dur: number } | null>(null);
  const [detail, setDetail] = useState<MyRow | null>(null);
  const [editWhen, setEditWhen] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [rules, setRules] = useState<BookingRules>({ min_notice_hours: 0, booking_horizon_days: 0 });
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("min_notice_hours, booking_horizon_days")
        .eq("id", 1)
        .maybeSingle();
      if (data) setRules({ min_notice_hours: data.min_notice_hours ?? 0, booking_horizon_days: data.booking_horizon_days ?? 0 });
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
      supabase.from("interview_requests").select("id, role, status, scheduled_at, preferred_at, duration_minutes, meeting_link, interview_type"),
    ]);
    setAvail((data as Availability) ?? { available: [], busy: [], taken: [] });
    setMine((mineRows as MyRow[]) ?? []);
    setLoading(false);
  }, []);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "availability_slots" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, reload)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const events = useMemo<EventInput[]>(() => {
    if (!avail || !range) return [];
    const availIvals = avail.available.flatMap((a) =>
      expandRecurring(ms(a.starts_at), ms(a.ends_at), a.repeat_rule ?? "none", range.start, range.end),
    );
    const blocked = [
      ...avail.busy.flatMap((b) => expandRecurring(ms(b.starts_at), ms(b.ends_at), b.repeat_rule ?? "none", range.start, range.end)),
      ...avail.taken.map((t) => ({ s: ms(t.starts_at), e: ms(t.ends_at) })),
    ];
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
        backgroundColor: "rgba(34,197,94,0.55)",
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
        backgroundColor: "rgba(239,68,68,0.5)",
        classNames: ["fc-busy-block"],
      });
    }

    // The candidate's own requests/interviews (only within the visible window).
    for (const r of mine) {
      if (["cancelled", "rejected", "completed"].includes(r.status)) continue;
      const at = r.scheduled_at || r.preferred_at;
      if (!at) continue;
      const s = ms(at);
      const e = s + (r.duration_minutes || 30) * 60000;
      if (e < range.start || s > range.end) continue;
      const tone = MINE_TONE[r.status] ?? MINE_TONE.pending;
      out.push({
        id: `mine-${r.id}`,
        title: `${r.role} · ${r.status}`,
        start: new Date(s),
        end: new Date(e),
        backgroundColor: tone.bg,
        borderColor: tone.border,
        textColor: tone.text,
        extendedProps: { own: true, rowId: r.id },
      });
    }
    return out;
  }, [avail, range, mine]);

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
      {/* Clear green "Available" / red "Busy" bands with visible labels. */}
      <style>{`
        /* FullCalendar dims background events to 0.3 by default — force full strength. */
        .fc-free-slot,.fc-busy-block{opacity:1!important;}
        .fc-free-slot{box-shadow:inset 5px 0 0 #16a34a;}
        .fc-busy-block{box-shadow:inset 5px 0 0 #dc2626;}
        .fc-free-slot .fc-event-title,.fc-busy-block .fc-event-title{
          font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;
          padding:3px 7px;opacity:1;font-style:normal;
        }
        .fc-free-slot .fc-event-title{color:#dcfce7;}
        .fc-busy-block .fc-event-title{color:#fee2e2;}
      `}</style>
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
          <CalendarSettings value={prefs} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calRef}
            plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView={prefs.bookingView}
            timeZone={prefs.timeZone}
            headerToolbar={false}
            height={660}
            allDaySlot={false}
            nowIndicator
            selectable
            selectMirror
            slotDuration="00:30:00"
            snapDuration="00:05:00"
            firstDay={prefs.weekStart}
            slotMinTime={hourStr(prefs.dayStart)}
            slotMaxTime={hourStr(prefs.dayEnd)}
            scrollTime={hourStr(prefs.dayStart)}
            eventTimeFormat={timeFormat(prefs.hour12)}
            slotLabelFormat={timeFormat(prefs.hour12)}
            events={events}
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
            select={(info) => {
              api()?.unselect();
              if (info.start.getTime() < Date.now()) return;
              const violation = ruleViolation(info.start.getTime());
              if (violation) {
                toast({ title: "Can't book that time", description: violation, variant: "info" });
                return;
              }
              const durMin = Math.max(5, Math.round((info.end.getTime() - info.start.getTime()) / 60000));
              setSelected({ startISO: info.start.toISOString(), dur: durMin });
            }}
          />
        ) : (
          <div className="h-[620px] animate-pulse rounded-lg bg-white/[0.02]" />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-white/45">
        {loading ? (
          <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading times…</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-[#a5b4fc]" />
            <span className="text-white/70">Drag over any time to request it</span> — you can ask for busy times too; the admin confirms.
            <span className="ml-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#10b981" }} />
            <span className="text-white/40">available</span>
            <span className="ml-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#ef4444" }} />
            <span className="text-white/40">busy</span>
            <span className="ml-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />
            <span className="text-white/40">your requests</span>
          </span>
        )}
        <span className="text-white/30">· Times in your local timezone</span>
      </div>

      {selected ? (
        <Dialog
          open
          onClose={() => setSelected(null)}
          title="Request this time"
          description={`${formatInTimeZone(selected.startISO, timezone)} · ${selected.dur} min`}
        >
          <InterviewRequestForm
            userId={userId}
            timezone={timezone}
            materials={materials}
            fixedStart={{ iso: selected.startISO, durationMin: selected.dur }}
            onDone={() => {
              setSelected(null);
              if (range) load(range.start, range.end);
            }}
          />
        </Dialog>
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
