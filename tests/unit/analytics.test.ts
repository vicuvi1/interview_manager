import { describe, expect, it } from "vitest";

import {
  completionRate,
  computeFunnel,
  lastMonths,
  prevMonthKey,
  statusCounts,
  sumPaid,
} from "@/lib/analytics";
import type { InterviewRequest, Payment } from "@/lib/types";

function req(status: string): InterviewRequest {
  return {
    id: Math.random().toString(36).slice(2),
    candidate_id: "c1",
    role: "Engineer",
    interviewer_id: null,
    preferred_at: null,
    scheduled_at: null,
    meeting_link: null,
    duration_minutes: 30,
    notes: null,
    status: status as InterviewRequest["status"],
    payment_status: "unpaid",
    price_cents: null,
    currency: "USD",
    paid_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function pay(status: string, amount: number): Payment {
  return {
    id: Math.random().toString(36).slice(2),
    interview_id: null,
    candidate_id: "c1",
    amount,
    currency: "USD",
    method: "cash",
    status,
    paid_at: null,
    notes: null,
    receipt_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("statusCounts", () => {
  it("tallies by status", () => {
    const c = statusCounts([req("pending"), req("pending"), req("completed")]);
    expect(c.pending).toBe(2);
    expect(c.completed).toBe(1);
  });
});

describe("computeFunnel", () => {
  it("is monotonically non-increasing", () => {
    const rows = [req("pending"), req("approved"), req("scheduled"), req("completed")];
    const f = computeFunnel(rows);
    expect(f.map((s) => s.value)).toEqual([4, 3, 2, 1]);
  });
  it("counts later stages toward earlier ones", () => {
    const f = computeFunnel([req("completed")]);
    // a completed request counts as requested, approved, scheduled, and completed
    expect(f.map((s) => s.value)).toEqual([1, 1, 1, 1]);
  });
});

describe("completionRate", () => {
  it("returns 0 with no requests", () => {
    expect(completionRate([])).toBe(0);
  });
  it("computes a percentage", () => {
    expect(completionRate([req("completed"), req("pending"), req("pending"), req("completed")])).toBe(50);
  });
});

describe("sumPaid", () => {
  it("sums only paid payments", () => {
    expect(sumPaid([pay("paid", 100), pay("pending", 50), pay("paid", 25)])).toBe(125);
  });
  it("handles numeric strings", () => {
    expect(sumPaid([{ ...pay("paid", 0), amount: "40.5" as unknown as number }])).toBe(40.5);
  });
});

describe("prevMonthKey / lastMonths", () => {
  it("rolls over the year boundary", () => {
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(prevMonthKey("2026-07")).toBe("2026-06");
  });
  it("returns N months oldest-first ending at the given month", () => {
    expect(lastMonths("2026-03", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
