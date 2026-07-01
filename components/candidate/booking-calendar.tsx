"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { INTERVIEW_TYPES } from "@/lib/interview";
import { expandRecurring, overlaps } from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

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
}

const ms = (iso: string) => new Date(iso).getTime();

const MINE_TONE: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "rgba(99,102,241,0.28)", border: "#6366f1", text: "#c7d2fe" },
  pending: { bg: "rgba(245,158,11,0.22)", border: "#f59e0b", text: "#fbbf24" },
  approved: { bg: "rgba(16,185,129,0.22)", border: "#10b981", text: "#6ee7b7" },
};

export function BookingCalendar({ timezone }: { timezone: string }) {
  const { toast } = useToast();
  const calRef = useRef<FullCalendar>(null);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("timeGridWeek");
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [mine, setMine] = useState<MyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(30);
  const [selected, setSelected] = useState<{ startISO: string; dur: number } | null>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async (from: number, to: number) => {
    setLoading(true);
    const supabase = createClient();
    const [{ data }, { data: mineRows }] = await Promise.all([
      supabase.rpc("get_booking_availability", {
        p_from: new Date(from).toISOString(),
        p_to: new Date(to).toISOString(),
      }),
      // RLS returns only this candidate's own requests.
      supabase.from("interview_requests").select("id, role, status, scheduled_at, preferred_at, duration_minutes"),
    ]);
    setAvail((data as Availability) ?? { available: [], busy: [], taken: [] });
    setMine((mineRows as MyRow[]) ?? []);
    setLoading(false);
  }, []);

  const events = useMemo<EventInput[]>(() => {
    if (!avail || !range) return [];
    const availIvals = avail.available.flatMap((a) =>
      expandRecurring(ms(a.starts_at), ms(a.ends_at), a.repeat_rule ?? "none", range.start, range.end),
    );
    const blocked = [
      ...avail.busy.flatMap((b) => expandRecurring(ms(b.starts_at), ms(b.ends_at), b.repeat_rule ?? "none", range.start, range.end)),
      ...avail.taken.map((t) => ({ s: ms(t.starts_at), e: ms(t.ends_at) })),
    ];
    const step = duration * 60000;
    const now = Date.now();
    const out: EventInput[] = [];

    // Dimmed "unavailable" shading for busy blocks + already-taken interviews.
    for (const b of blocked) {
      out.push({
        id: `blk-${b.s}-${b.e}`,
        start: new Date(b.s),
        end: new Date(b.e),
        display: "background",
        backgroundColor: "rgba(255,255,255,0.06)",
        classNames: ["fc-busy-slot"],
        extendedProps: { blocked: true },
      });
    }

    for (const iv of availIvals) {
      for (let t = iv.s; t + step <= iv.e && out.length < 300; t += step) {
        if (t < now) continue;
        const end = t + step;
        if (blocked.some((b) => overlaps(t, end, b.s, b.e))) continue;
        out.push({
          id: `slot-${t}`,
          title: "Available",
          start: new Date(t),
          end: new Date(end),
          backgroundColor: "rgba(16,185,129,0.18)",
          borderColor: "#10b981",
          textColor: "#6ee7b7",
          extendedProps: { startISO: new Date(t).toISOString(), dur: duration },
        });
      }
    }
    // The candidate's own requests/interviews, so they see what they already have.
    for (const r of mine) {
      if (["cancelled", "rejected", "completed"].includes(r.status)) continue;
      const at = r.scheduled_at || r.preferred_at;
      if (!at) continue;
      const s = ms(at);
      const tone = MINE_TONE[r.status] ?? MINE_TONE.pending;
      out.push({
        id: `mine-${r.id}`,
        title: `${r.role} · ${r.status}`,
        start: new Date(s),
        end: new Date(s + (r.duration_minutes || 30) * 60000),
        backgroundColor: tone.bg,
        borderColor: tone.border,
        textColor: tone.text,
        extendedProps: { own: true },
      });
    }
    return out;
  }, [avail, range, duration, mine]);

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
          <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-9 w-32">
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
          </Select>
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        {mounted ? (
          <FullCalendar
            ref={calRef}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={false}
            height={620}
            allDaySlot={false}
            nowIndicator
            scrollTime="08:00:00"
            slotDuration="00:30:00"
            expandRows
            eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            events={events}
            datesSet={(arg) => {
              setRange({ start: arg.start.getTime(), end: arg.end.getTime() });
              setTitle(arg.view.title);
              setView(arg.view.type);
              load(arg.start.getTime(), arg.end.getTime());
            }}
            eventClick={(info) => {
              const p = info.event.extendedProps as { startISO?: string; dur?: number };
              if (p.startISO) setSelected({ startISO: p.startISO, dur: p.dur ?? duration });
            }}
            dateClick={(info) => {
              if (info.date.getTime() < Date.now()) return;
              setSelected({ startISO: info.date.toISOString(), dur: duration });
            }}
          />
        ) : (
          <div className="h-[620px] animate-pulse rounded-lg bg-white/[0.02]" />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-white/45">
        {loading ? (
          <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading times…</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-[#a5b4fc]" /> Click any time to request it — the admin approves it.
            <span className="ml-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#10b981" }} />
            <span className="text-white/40">green = suggested</span>
            <span className="ml-1 h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />
            <span className="text-white/40">your requests</span>
            <span className="ml-1 h-2.5 w-2.5 rounded-sm bg-white/15" />
            <span className="text-white/40">unavailable</span>
          </span>
        )}
        <span className="text-white/30">· Times in your local timezone</span>
      </div>

      {selected ? (
        <ConfirmBooking
          startISO={selected.startISO}
          durationMin={selected.dur}
          timezone={timezone}
          onClose={() => setSelected(null)}
          onBooked={() => {
            setSelected(null);
            if (range) load(range.start, range.end);
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmBooking({
  startISO,
  durationMin,
  timezone,
  onClose,
  onBooked,
}: {
  startISO: string;
  durationMin: number;
  timezone: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState("");
  const [type, setType] = useState(INTERVIEW_TYPES[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (role.trim().length < 2) return setError("Add a role or topic.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("book_open_slot", {
      p_role: role.trim(),
      p_starts_at: startISO,
      p_duration: durationMin,
      p_interview_type: type,
      p_format: "video",
      p_notes: notes.trim() || null,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    notifyChanged("interviews");
    toast({ title: "Request sent", description: "The admin will review and confirm your time.", variant: "success" });
    setBusy(false);
    onBooked();
  }

  return (
    <Dialog open onClose={onClose} title="Request this time" description={`${formatInTimeZone(startISO, timezone)} · ${durationMin} min`}>
      <div className="space-y-4">
        <Field label="Role / topic" htmlFor="bk-role">
          <Input id="bk-role" placeholder="e.g. Senior Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Interview type" htmlFor="bk-type">
          <Select id="bk-type" value={type} onChange={(e) => setType(e.target.value)}>
            {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Notes (optional)" htmlFor="bk-notes">
          <Textarea id="bk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the interviewer should know…" />
        </Field>
        <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/45">
          This sends a request for the admin to approve — you&apos;ll be notified once your time is confirmed.
        </p>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={confirm}>Request this time</Button>
      </div>
    </Dialog>
  );
}
