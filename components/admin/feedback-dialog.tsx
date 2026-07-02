"use client";

import { useEffect, useState } from "react";
import { Clock, ListChecks, Loader2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { OUTCOMES } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { InterviewFeedback, InterviewRequest } from "@/lib/types";

export function FeedbackDialog({
  request,
  candidateName,
  adminId,
  onClose,
  onDone,
}: {
  request: InterviewRequest;
  candidateName: string;
  adminId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState("hold");
  const [rating, setRating] = useState(0);
  const [strengths, setStrengths] = useState("");
  const [concerns, setConcerns] = useState("");
  const [sharedFeedback, setSharedFeedback] = useState("");
  const [actionItems, setActionItems] = useState("");
  const [actualMinutes, setActualMinutes] = useState("");
  const [meetingLink, setMeetingLink] = useState(request.meeting_link ?? "");
  const [shared, setShared] = useState(false);
  const [markCompleted, setMarkCompleted] = useState(request.status !== "completed");
  const [busy, setBusy] = useState(false);
  const [todoProgress, setTodoProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("interview_feedback")
        .select("*")
        .eq("interview_id", request.id)
        .maybeSingle();
      if (active && data) {
        const f = data as InterviewFeedback;
        setOutcome(f.outcome);
        setRating(f.rating ?? 0);
        setStrengths(f.strengths ?? "");
        setConcerns(f.concerns ?? "");
        setSharedFeedback(f.shared_feedback ?? "");
        setActionItems(f.action_items ?? "");
        setActualMinutes(f.actual_minutes != null ? String(f.actual_minutes) : "");
        setShared(f.shared);
        const items = (f.action_items ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
        if (items.length) {
          const done = (f.action_items_done ?? []).filter((i) => i >= 0 && i < items.length).length;
          setTodoProgress({ done, total: items.length });
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [request.id]);

  async function submit() {
    setBusy(true);
    const supabase = createClient();
    const mins = actualMinutes.trim() ? Math.max(0, Math.min(1440, Math.round(Number(actualMinutes)))) : null;
    const { error } = await supabase.from("interview_feedback").upsert(
      {
        interview_id: request.id,
        author_id: adminId,
        outcome,
        rating: rating || null,
        strengths: strengths.trim() || null,
        concerns: concerns.trim() || null,
        shared_feedback: sharedFeedback.trim() || null,
        action_items: actionItems.trim() || null,
        actual_minutes: mins,
        shared,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "interview_id" },
    );
    if (error) {
      toast({ title: "Couldn't save feedback", description: error.message, variant: "error" });
      setBusy(false);
      return;
    }
    // Keep the meeting link on the interview in sync (shared with the candidate).
    const nextLink = meetingLink.trim() || null;
    if (nextLink !== (request.meeting_link ?? null)) {
      await supabase.from("interview_requests").update({ meeting_link: nextLink }).eq("id", request.id);
    }
    if (markCompleted && request.status !== "completed") {
      await supabase.from("interview_requests").update({ status: "completed" }).eq("id", request.id);
    }
    if (shared) {
      await supabase.from("notifications").insert({
        user_id: request.candidate_id,
        title: "Interview feedback is ready",
        detail: `Feedback${mins ? ` (${mins} min session)` : ""} for your "${request.role}" interview is now available.`,
        type: "info",
      });
    }
    toast({ title: "Feedback saved", variant: "success" });
    setBusy(false);
    notifyChanged("interviews");
    onDone();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Interview feedback" description={`${request.role} · ${candidateName}`}>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Outcome" htmlFor="fb-outcome">
              <Select id="fb-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-white/55">Rating</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n === rating ? 0 : n)}
                    className="p-0.5"
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  >
                    <Star className={cn("h-5 w-5", n <= rating ? "fill-[#fbbf24] text-[#fbbf24]" : "text-white/25")} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How long it ran (minutes)" htmlFor="fb-minutes" hint="Shared with the candidate.">
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <Input
                  id="fb-minutes"
                  type="number"
                  min={0}
                  max={1440}
                  inputMode="numeric"
                  placeholder="e.g. 45"
                  value={actualMinutes}
                  onChange={(e) => setActualMinutes(e.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>
            <Field label="Meeting link" htmlFor="fb-link" hint="Shared with the candidate.">
              <div className="flex items-center gap-1.5">
                <Input id="fb-link" placeholder="https://…" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
                <CopyButton value={meetingLink.trim() || undefined} title="Copy meeting link" />
              </div>
            </Field>
          </div>

          <Field label="Strengths" htmlFor="fb-strengths" hint="Internal — not shown to the candidate.">
            <Textarea id="fb-strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} className="min-h-[64px]" />
          </Field>
          <Field label="Concerns" htmlFor="fb-concerns" hint="Internal — not shown to the candidate.">
            <Textarea id="fb-concerns" value={concerns} onChange={(e) => setConcerns(e.target.value)} className="min-h-[64px]" />
          </Field>

          {todoProgress ? (
            <div className="flex items-center gap-2 rounded-lg bg-[#34d399]/[0.08] px-3 py-2 text-[12px] text-[#6ee7b7] ring-1 ring-inset ring-[#34d399]/20">
              <ListChecks className="h-3.5 w-3.5" />
              Candidate completed <span className="font-semibold">{todoProgress.done} of {todoProgress.total}</span> to-do items.
            </div>
          ) : null}
          <Field label="To-do list for the candidate" htmlFor="fb-todo" hint="Shared when you enable sharing below. One item per line.">
            <div className="relative">
              <ListChecks className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-white/30" />
              <Textarea
                id="fb-todo"
                value={actionItems}
                onChange={(e) => setActionItems(e.target.value)}
                placeholder={"Review data-structures\nPractice system design\nSend follow-up email"}
                className="min-h-[80px] pl-9"
              />
            </div>
          </Field>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
            <Field label="Feedback for the candidate" htmlFor="fb-shared" hint="Only sent if you enable sharing below.">
              <Textarea
                id="fb-shared"
                value={sharedFeedback}
                onChange={(e) => setSharedFeedback(e.target.value)}
                placeholder="What went well, and what to work on…"
              />
            </Field>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
              />
              Share this feedback with {candidateName}
            </label>
          </div>

          {request.status !== "completed" ? (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
              <input
                type="checkbox"
                checked={markCompleted}
                onChange={(e) => setMarkCompleted(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
              />
              Mark this interview completed
            </label>
          ) : null}

          <Button className="w-full" loading={busy} onClick={submit}>
            Save feedback
          </Button>
        </div>
      )}
    </Dialog>
  );
}
