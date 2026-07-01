import type { Tone } from "@/components/ui/badge";

/** The ordered interview pipeline. "rejected" is a terminal state off-pipeline. */
export const STAGES = [
  { value: "applied", label: "Applied" },
  { value: "hr", label: "HR Screen" },
  { value: "technical", label: "Technical" },
  { value: "final", label: "Final" },
  { value: "hired", label: "Hired" },
] as const;

export const REJECTED = "rejected";

export const STAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(STAGES.map((s) => [s.value, s.label])),
  rejected: "Rejected",
};

export function stageIndex(value: string): number {
  return STAGES.findIndex((s) => s.value === value);
}

export function stageTone(value: string): Tone {
  if (value === "rejected") return "red";
  if (value === "hired") return "green";
  if (value === "applied") return "slate";
  return "indigo";
}
