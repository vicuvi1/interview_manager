import type { Tone } from "@/components/ui/badge";

export const OUTCOMES = [
  { value: "advance", label: "Advance", tone: "green" as Tone },
  { value: "hold", label: "Hold", tone: "amber" as Tone },
  { value: "reject", label: "Reject", tone: "red" as Tone },
  { value: "no_show", label: "No-show", tone: "slate" as Tone },
];

export const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOMES.map((o) => [o.value, o.label]),
);

export const OUTCOME_TONE: Record<string, Tone> = Object.fromEntries(
  OUTCOMES.map((o) => [o.value, o.tone]),
);
