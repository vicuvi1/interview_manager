import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { InterviewStatus } from "@/lib/types";

const STEPS = ["Requested", "Approved", "Confirmed", "Completed"] as const;
// How many of the 4 steps are complete for each on-track status.
const REACHED: Record<string, number> = { pending: 1, approved: 2, scheduled: 3, completed: 4 };

/**
 * A four-step progress tracker (Requested → Approved → Confirmed → Completed)
 * that shows, at a glance, where an interview stands and what's next. Rejected
 * and cancelled interviews render a short terminal state instead. Shared by the
 * candidate and admin detail views.
 */
export function InterviewProgress({ status, className }: { status: InterviewStatus; className?: string }) {
  const terminal =
    status === "rejected"
      ? { label: "Rejected", color: "#ef4444" }
      : status === "cancelled"
        ? { label: "Cancelled", color: "#94a3b8" }
        : null;

  if (terminal) {
    return (
      <ol className={cn("flex items-center gap-2 text-[11px] font-medium", className)}>
        <li className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#6366f1] text-white">
            <Check className="h-3 w-3" />
          </span>
          <span className="text-white/70">Requested</span>
        </li>
        <span className="h-0.5 w-6 rounded bg-white/[0.08]" />
        <li className="flex items-center gap-1.5">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: terminal.color }}
          >
            <X className="h-3 w-3" />
          </span>
          <span style={{ color: terminal.color }}>{terminal.label}</span>
        </li>
      </ol>
    );
  }

  const reached = REACHED[status] ?? 1;
  return (
    <ol className={cn("flex items-start", className)}>
      {STEPS.map((label, i) => {
        const done = i < reached;
        const current = i === reached; // the next step, in progress
        const isFinalDone = done && i === STEPS.length - 1;
        return (
          <li key={label} className={cn("flex items-start", i < STEPS.length - 1 && "flex-1")}>
            <div className="flex w-14 shrink-0 flex-col items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  done
                    ? isFinalDone
                      ? "bg-[#10b981] text-white"
                      : "bg-[#6366f1] text-white"
                    : current
                      ? "border-2 border-[#6366f1] text-[#a5b4fc]"
                      : "bg-white/[0.08] text-white/40",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-center text-[10px] font-medium leading-tight",
                  done ? "text-white/75" : current ? "text-[#a5b4fc]" : "text-white/35",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <span className={cn("mt-[9px] h-0.5 flex-1 rounded", i < reached - 1 ? "bg-[#6366f1]" : "bg-white/[0.08]")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
