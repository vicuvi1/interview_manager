/**
 * The interview lifecycle as pure data: which status transitions are allowed
 * and what candidate notification each produces. This is the single source of
 * truth shared by the admin Manage dialog and the money-path test, so the
 * "book → schedule → complete → paid" flow can't silently drift.
 */
import type { InterviewStatus } from "./types";

export type LifecycleAction =
  | "book"
  | "approve"
  | "reject"
  | "schedule"
  | "complete"
  | "cancel"
  | "reopen"
  | "mark_paid";

export interface ActionMeta {
  /** Interview status after the action (unchanged for mark_paid). */
  target: InterviewStatus | null;
  /** Candidate notification title + type the action emits. */
  title: string;
  type: string;
}

export const ACTION_META: Record<LifecycleAction, ActionMeta> = {
  book: { target: "scheduled", title: "Interview booked", type: "approved" },
  approve: { target: "approved", title: "Interview approved", type: "approved" },
  reject: { target: "rejected", title: "Interview not approved", type: "rejected" },
  schedule: { target: "scheduled", title: "Interview scheduled", type: "approved" },
  complete: { target: "completed", title: "Interview completed", type: "success" },
  cancel: { target: "cancelled", title: "Interview cancelled", type: "alert" },
  reopen: { target: "pending", title: "Request reopened", type: "info" },
  mark_paid: { target: null, title: "Payment confirmed", type: "success" },
};

/** Status-transition actions offered for an interview in a given status. */
export const ACTIONS_BY_STATUS: Record<InterviewStatus, Extract<LifecycleAction, "approve" | "reject" | "complete" | "cancel">[]> = {
  pending: ["approve", "reject"],
  approved: ["complete", "cancel"],
  scheduled: ["complete", "cancel"],
  rejected: [],
  completed: [],
  cancelled: [],
};

/** Statuses from which the admin may (re)schedule a concrete time. */
const SCHEDULABLE: InterviewStatus[] = ["pending", "approved", "scheduled"];
/** Statuses from which a payment can be recorded. */
const PAYABLE: InterviewStatus[] = ["approved", "scheduled", "completed"];

export function canApply(status: InterviewStatus, action: LifecycleAction): boolean {
  if (action === "schedule") return SCHEDULABLE.includes(status);
  if (action === "mark_paid") return PAYABLE.includes(status);
  if (action === "book") return status === "pending" || status === "approved";
  return (ACTIONS_BY_STATUS[status] ?? []).some((a) => a === action);
}

/** The status after applying an action (throws if the action isn't allowed). */
export function nextStatus(status: InterviewStatus, action: LifecycleAction): InterviewStatus {
  if (!canApply(status, action)) throw new Error(`Illegal transition: ${action} from "${status}"`);
  return ACTION_META[action].target ?? status;
}

export function notificationFor(action: LifecycleAction): { title: string; type: string } {
  const { title, type } = ACTION_META[action];
  return { title, type };
}
