"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";
import type { InterviewRequest } from "@/lib/types";

/**
 * Candidate-facing "propose / self-serve reschedule" dialog. Works for any of
 * the candidate's own interviews — including a rejected one, which lets them
 * re-request a workable time instead of starting over. If the new time is
 * genuinely inside published availability it's rebooked instantly
 * (`reschedule_to_open_slot`); otherwise it falls back to a proposal the admin
 * confirms (`propose_reschedule`). Shared by the calendar popover and the
 * "My interviews" list so both stay in sync.
 */
export function RescheduleDialog({
  request,
  timezone,
  onClose,
}: {
  request: Pick<InterviewRequest, "id" | "role" | "scheduled_at" | "preferred_at">;
  timezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!when) return setError("Pick a new date & time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const iso = wallTimeToUtcISO(when, timezone);
    // If the new time is genuinely inside published availability, rebook it
    // instantly; otherwise fall back to a proposal the admin confirms. (A
    // rejected interview always takes the proposal path — the RPC returns false
    // for non-active statuses — so the admin re-approves the new time.)
    const { data: booked } = await supabase.rpc("reschedule_to_open_slot", { p_interview_id: request.id, p_at: iso });
    if (booked === true) {
      setBusy(false);
      toast({ title: "Rescheduled", description: "Your new time is confirmed — it's on your calendar.", variant: "success" });
      notifyChanged("interviews");
      onClose();
      return;
    }
    const { error: rpcError } = await supabase.rpc("propose_reschedule", { p_interview_id: request.id, p_at: iso });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast({ title: "New time proposed", description: "That time isn't open — we've sent it to the admin to confirm.", variant: "success" });
    notifyChanged("interviews");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Reschedule" description={request.role}>
      <div className="space-y-4">
        <div className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[13px]">
          <p className="text-white/45">Current time</p>
          <p className="mt-0.5 font-medium text-[#f0f0f5]">
            {formatInTimeZone(request.scheduled_at ?? request.preferred_at, timezone)}
          </p>
        </div>
        <Field
          label="New time"
          htmlFor="resched-when"
          hint={`Times in ${timezone}. If it's an open slot you're rebooked instantly; otherwise the admin confirms.`}
        >
          <Input
            id="resched-when"
            type="datetime-local"
            min={utcToLocalInput(new Date().toISOString(), timezone)}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy || !when} onClick={submit}>
          <CalendarClock className="h-4 w-4" /> Reschedule
        </Button>
      </div>
    </Dialog>
  );
}
