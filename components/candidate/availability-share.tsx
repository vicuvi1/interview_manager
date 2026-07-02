"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";

interface Window {
  id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
}

export function AvailabilityShare({ userId, timezone }: { userId: string; timezone: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Window[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("candidate_availability")
      .select("id, starts_at, ends_at, note")
      .eq("candidate_id", userId)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true });
    if (data) setRows(data as Window[]);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!start || !end) return toast({ title: "Pick a start and end", variant: "error" });
    const startIso = wallTimeToUtcISO(start, timezone);
    const endIso = wallTimeToUtcISO(end, timezone);
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      return toast({ title: "End must be after start", variant: "error" });
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("candidate_availability").insert({
      candidate_id: userId,
      starts_at: startIso,
      ends_at: endIso,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    setStart("");
    setEnd("");
    setNote("");
    toast({ title: "Availability shared", description: "The team can now schedule you here.", variant: "success" });
    notifyChanged("interviews");
    load();
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("candidate_availability").delete().eq("id", id);
    if (error) return toast({ title: "Couldn't remove", description: error.message, variant: "error" });
    load();
  }

  return (
    <SectionCard
      title="Share when you're free"
      description="Flexible on timing? Add windows and we'll pick a slot that fits — no need to request an exact time."
      icon={CalendarClock}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor="av-start">
            <Input id="av-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="av-end">
            <Input id="av-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)" htmlFor="av-note">
          <Input id="av-note" placeholder="e.g. mornings work best" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-between">
          <p className="text-[11px] text-white/35">Times shown in {timezone}.</p>
          <Button size="sm" loading={busy} disabled={busy} onClick={add}>
            <Plus className="h-4 w-4" /> Add window
          </Button>
        </div>

        {rows.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {rows.map((w) => (
              <span
                key={w.id}
                title={w.note ?? undefined}
                className="inline-flex items-center gap-2 rounded-full border border-[#6366f1]/25 bg-[#6366f1]/[0.08] py-1.5 pl-3 pr-2 text-[12px] font-medium text-[#c7d2fe]"
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-[#a5b4fc]" />
                {formatInTimeZone(w.starts_at, timezone)} — {formatInTimeZone(w.ends_at, timezone)}
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  className="shrink-0 rounded-full p-0.5 text-white/40 transition hover:bg-white/[0.1] hover:text-[#f87171]"
                  aria-label="Remove window"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
