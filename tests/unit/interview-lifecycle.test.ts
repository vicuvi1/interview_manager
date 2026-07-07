import { describe, expect, it } from "vitest";

import {
  ACTIONS_BY_STATUS,
  canApply,
  type LifecycleAction,
  nextStatus,
  notificationFor,
} from "@/lib/interview-lifecycle";
import type { InterviewStatus } from "@/lib/types";

describe("interview money path: book → schedule → complete → paid", () => {
  it("walks the happy path, asserting each transition + notification", () => {
    // A candidate books a time → the interview is scheduled.
    let status: InterviewStatus = "pending";
    expect(canApply(status, "schedule")).toBe(true);
    status = nextStatus(status, "schedule");
    expect(status).toBe("scheduled");
    expect(notificationFor("schedule")).toEqual({ title: "Interview scheduled", type: "approved" });

    // Admin marks it completed.
    expect(canApply(status, "complete")).toBe(true);
    status = nextStatus(status, "complete");
    expect(status).toBe("completed");
    expect(notificationFor("complete")).toEqual({ title: "Interview completed", type: "success" });

    // Payment is recorded — status stays "completed", candidate is thanked.
    expect(canApply(status, "mark_paid")).toBe(true);
    expect(nextStatus(status, "mark_paid")).toBe("completed");
    expect(notificationFor("mark_paid")).toEqual({ title: "Payment confirmed", type: "success" });
  });

  it("supports the approve-first path (pending → approved → scheduled)", () => {
    let status: InterviewStatus = "pending";
    expect(canApply(status, "approve")).toBe(true);
    status = nextStatus(status, "approve");
    expect(status).toBe("approved");
    status = nextStatus(status, "schedule");
    expect(status).toBe("scheduled");
  });
});

describe("illegal transitions are rejected", () => {
  it("cannot complete a pending interview", () => {
    expect(canApply("pending", "complete")).toBe(false);
    expect(() => nextStatus("pending", "complete")).toThrow(/Illegal transition/);
  });

  it("cannot act on a terminal (cancelled/rejected/completed) interview", () => {
    for (const s of ["cancelled", "rejected"] as InterviewStatus[]) {
      expect(ACTIONS_BY_STATUS[s]).toEqual([]);
      expect(canApply(s, "schedule")).toBe(false);
      expect(canApply(s, "complete")).toBe(false);
    }
    // A completed interview accepts no more status changes, but can still be paid.
    expect(ACTIONS_BY_STATUS.completed).toEqual([]);
    expect(canApply("completed", "cancel")).toBe(false);
    expect(canApply("completed", "mark_paid")).toBe(true);
  });

  it("cannot record payment before the interview is at least approved", () => {
    expect(canApply("pending", "mark_paid")).toBe(false);
  });
});

describe("status action menus match the admin dialog", () => {
  it("offers approve/reject only while pending", () => {
    expect(ACTIONS_BY_STATUS.pending).toEqual(["approve", "reject"]);
  });
  it("offers complete/cancel once approved or scheduled", () => {
    expect(ACTIONS_BY_STATUS.approved).toEqual(["complete", "cancel"]);
    expect(ACTIONS_BY_STATUS.scheduled).toEqual(["complete", "cancel"]);
  });
  it("every status-menu action is applicable from that status", () => {
    (Object.keys(ACTIONS_BY_STATUS) as InterviewStatus[]).forEach((status) => {
      for (const action of ACTIONS_BY_STATUS[status] as LifecycleAction[]) {
        expect(canApply(status, action)).toBe(true);
      }
    });
  });
});
