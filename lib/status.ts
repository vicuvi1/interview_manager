/** Interview status display: labels + colors, admin-overridable via app_settings. */

import type { InterviewStatus } from "@/lib/types";

/** All statuses, in the order they should appear in editors/legends. */
export const ALL_STATUSES: InterviewStatus[] = [
  "pending",
  "approved",
  "scheduled",
  "completed",
  "rejected",
  "cancelled",
];

export const DEFAULT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  scheduled: "Scheduled",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Defaults keep the familiar scheme: yellow pending, blue accepted, green done.
export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  approved: "#3b82f6",
  scheduled: "#6366f1",
  completed: "#22c55e",
  rejected: "#ef4444",
  cancelled: "#9ca3af",
};

export type StatusLabelMap = Record<string, string>;
export type StatusColorMap = Record<string, string>;

/** Display label for a status (admin override → default → the raw key). */
export function statusLabel(status: string | null | undefined, map?: StatusLabelMap | null): string {
  if (!status) return "";
  const custom = map?.[status];
  if (custom && custom.trim()) return custom.trim();
  return DEFAULT_STATUS_LABELS[status] ?? status;
}

/** Display color (hex) for a status (admin override → default → neutral gray). */
export function statusColor(status: string | null | undefined, map?: StatusColorMap | null): string {
  if (!status) return "#9ca3af";
  const custom = map?.[status];
  if (custom && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(custom)) return custom;
  return DEFAULT_STATUS_COLORS[status] ?? "#9ca3af";
}

/** Plain-language, candidate-facing "what does this mean / what's next" line. */
export const STATUS_HINTS: Record<string, string> = {
  pending: "Waiting for your interviewer to review it and pick a time — you'll be notified.",
  approved: "Approved! Your interviewer will confirm a time shortly.",
  scheduled: "You're confirmed. Use the Join link when it's time.",
  completed: "This interview is complete. Any results your interviewer shares show up here.",
  rejected: "Not approved this time — you can edit the details and propose a new time.",
  cancelled: "This interview was cancelled.",
};

export function statusHint(status: string | null | undefined): string {
  return status ? STATUS_HINTS[status] ?? "" : "";
}
