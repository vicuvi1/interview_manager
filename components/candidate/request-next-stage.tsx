"use client";

import { useMemo, useState } from "react";
import { CalendarClock, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { INTERVIEW_TYPES, defaultDurationFor, durationOptions } from "@/lib/interview";
import { useDurationSettings } from "@/lib/use-duration-settings";
import { createClient } from "@/lib/supabase/client";
import { utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";
import type { InterviewRequest } from "@/lib/types";

type PreviousInterview = Pick<
  InterviewRequest,
  "id" | "role" | "company" | "interview_type" | "level" | "format" | "duration_minutes"
>;

/** The stage after `current` in the standard progression (falls back to the
 *  current one, then the first) — just a sensible default the candidate can change. */
function suggestNextStage(current: string | null | undefined): string {
  if (current) {
    const i = INTERVIEW_TYPES.indexOf(current);
    if (i >= 0 && i < INTERVIEW_TYPES.length - 1) return INTERVIEW_TYPES[i + 1];
  }
  return current || INTERVIEW_TYPES[0];
}

/**
 * Candidate-facing "advance to the next stage" dialog, launched from a passed
 * (completed) interview. They pick the next stage + a preferred time; this
 * creates a NEW pending request (carrying the role/company forward) that the
 * admin accepts or rejects through the normal request lifecycle. Admins are
 * notified automatically by the new-request trigger.
 */
export function NextStageDialog({
  previous,
  userId,
  timezone,
  onClose,
}: {
  previous: PreviousInterview;
  userId: string;
  timezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { options: durOpts, typeDurations } = useDurationSettings();

  const [stage, setStage] = useState(() => suggestNextStage(previous.interview_type));
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(() =>
    defaultDurationFor(suggestNextStage(previous.interview_type), typeDurations, previous.duration_minutes ?? 30),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a custom (non-standard) previous type selectable.
  const stageOptions = useMemo(() => {
    const opts = [...INTERVIEW_TYPES];
    if (previous.interview_type && !opts.includes(previous.interview_type)) opts.unshift(previous.interview_type);
    return opts;
  }, [previous.interview_type]);

  async function submit() {
    if (!when) return setError("Pick a preferred date & time.");
    if (new Date(wallTimeToUtcISO(when, timezone)).getTime() <= Date.now()) {
      return setError("Pick a future time.");
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // A fresh pending request for the next round. The new-request trigger
    // notifies admins; status defaults to "pending" so it lands in their queue.
    const { error: insertError } = await supabase.from("interview_requests").insert({
      candidate_id: userId,
      role: previous.role,
      company: previous.company ?? null,
      interview_type: stage,
      level: previous.level ?? null,
      format: previous.format ?? null,
      preferred_at: wallTimeToUtcISO(when, timezone),
      duration_minutes: Math.max(5, Math.min(480, duration)),
      notes: `Next stage after "${previous.interview_type ?? previous.role}".`,
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    toast({
      title: "Next stage requested",
      description: "Your interviewer will accept a time or suggest another.",
      variant: "success",
    });
    notifyChanged("interviews");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Request the next stage" description={previous.role}>
      <div className="space-y-4">
        <Field label="Next stage" htmlFor="ns-stage" hint="Which round comes next.">
          <Select
            id="ns-stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setDuration(defaultDurationFor(e.target.value, typeDurations, previous.duration_minutes ?? 30));
            }}
          >
            {stageOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Preferred time (${timezone})`} htmlFor="ns-when">
            <Input
              id="ns-when"
              type="datetime-local"
              min={utcToLocalInput(new Date().toISOString(), timezone)}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field label="Duration" htmlFor="ns-dur">
            <Select id="ns-dur" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {durationOptions([...durOpts, duration]).map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-[12px] text-white/40">
          This sends a new request to your interviewer — they&apos;ll accept the time or propose another.
        </p>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy || !when} onClick={submit}>
          <CalendarClock className="h-4 w-4" /> Send request
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Self-contained button + dialog for surfaces without their own dialog state
 * (the interview detail page and the "My interviews" list). The calendar
 * popover uses {@link NextStageDialog} directly so it can close itself first.
 */
export function RequestNextStage({
  interview,
  userId,
  timezone,
  size = "sm",
  variant = "secondary",
  className,
}: {
  interview: PreviousInterview;
  userId: string;
  timezone: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <TrendingUp className="h-4 w-4" /> Request next stage
      </Button>
      {open ? (
        <NextStageDialog previous={interview} userId={userId} timezone={timezone} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
