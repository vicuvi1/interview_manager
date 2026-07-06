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
