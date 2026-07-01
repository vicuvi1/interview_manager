"use client";

import { useState } from "react";
import { ArrowRight, Ban, Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { REJECTED, STAGES, STAGE_LABEL, stageIndex } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function StageTracker({ candidateId, initialStage }: { candidateId: string; initialStage: string }) {
  const { toast } = useToast();
  const [stage, setStage] = useState(initialStage || "applied");
  const [busy, setBusy] = useState(false);

  const rejected = stage === REJECTED;
  const idx = stageIndex(stage);

  async function move(next: string) {
    if (next === stage) return;
    setBusy(true);
    const prev = stage;
    setStage(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_candidate_stage", { p_user: candidateId, p_stage: next });
    setBusy(false);
    if (error) {
      setStage(prev);
      toast({ title: "Couldn't update stage", description: error.message, variant: "error" });
    } else {
      toast({ title: `Moved to ${STAGE_LABEL[next] ?? next}`, variant: next === REJECTED ? "info" : "success" });
    }
  }

  const nextStage = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1].value : null;

  return (
    <SectionCard title="Pipeline stage" description="Track this candidate through the rounds." icon={ArrowRight}>
      {/* Stepper */}
      <div className="flex items-center">
        {STAGES.map((s, i) => {
          const done = !rejected && i < idx;
          const current = !rejected && i === idx;
          return (
            <div key={s.value} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                disabled={busy}
                onClick={() => move(s.value)}
                className="flex flex-col items-center gap-1.5"
                title={`Move to ${s.label}`}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                    done && "bg-[#34d399]/15 text-[#34d399]",
                    current && "bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white",
                    !done && !current && "bg-white/[0.05] text-white/40",
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cn("text-[11px]", current ? "font-medium text-[#f0f0f5]" : "text-white/45")}>
                  {s.label}
                </span>
              </button>
              {i < STAGES.length - 1 ? (
                <span className={cn("mx-1 h-0.5 flex-1 rounded-full", i < idx && !rejected ? "bg-[#34d399]/40" : "bg-white/[0.08]")} />
              ) : null}
            </div>
          );
        })}
      </div>

      {rejected ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#ef4444]/10 px-3.5 py-2.5 text-[13px] text-[#f87171] ring-1 ring-inset ring-[#ef4444]/25">
          <Ban className="h-4 w-4" /> This candidate was marked rejected.
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!rejected && nextStage ? (
          <Button size="sm" loading={busy} disabled={busy} onClick={() => move(nextStage)}>
            <ArrowRight className="h-4 w-4" /> Advance to {STAGE_LABEL[nextStage]}
          </Button>
        ) : null}
        {rejected ? (
          <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => move("applied")}>
            <RotateCcw className="h-4 w-4" /> Reopen
          </Button>
        ) : (
          <Button size="sm" variant="danger" loading={busy} disabled={busy} onClick={() => move(REJECTED)}>
            <Ban className="h-4 w-4" /> Reject
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
