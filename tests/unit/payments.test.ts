import { describe, expect, it } from "vitest";

import { METHOD_LABEL, PAYMENT_STATUS_TONE, formatAmount, isOutstandingInvoice, isPayableStatus } from "@/lib/payments";
import type { InterviewRequest } from "@/lib/types";

describe("formatAmount", () => {
  it("formats a dollar amount as currency", () => {
    expect(formatAmount(150, "USD")).toContain("150.00");
  });
  it("accepts a numeric string (Supabase numeric)", () => {
    expect(formatAmount("99.5", "USD")).toContain("99.50");
  });
  it("defaults to USD", () => {
    expect(formatAmount(10)).toContain("10.00");
  });
  it("falls back gracefully for an unknown currency code", () => {
    expect(formatAmount(5, "ZZZ")).toContain("5.00");
  });
});

describe("payment maps", () => {
  it("maps known methods to short labels", () => {
    expect(METHOD_LABEL.bank_transfer).toBe("Bank");
    expect(METHOD_LABEL.crypto_btc).toBe("BTC");
  });
  it("maps statuses to tones", () => {
    expect(PAYMENT_STATUS_TONE.paid).toBe("green");
    expect(PAYMENT_STATUS_TONE.overdue).toBe("red");
  });
});

describe("isPayableStatus", () => {
  it("is true for accepted/active statuses", () => {
    expect(isPayableStatus("approved")).toBe(true);
    expect(isPayableStatus("scheduled")).toBe(true);
    expect(isPayableStatus("completed")).toBe(true);
  });
  it("is false for pending and terminal statuses", () => {
    expect(isPayableStatus("pending")).toBe(false);
    expect(isPayableStatus("cancelled")).toBe(false);
    expect(isPayableStatus("rejected")).toBe(false);
  });
});

describe("isOutstandingInvoice", () => {
  const base = (over: Partial<InterviewRequest>): Pick<InterviewRequest, "price_cents" | "payment_status" | "status"> => ({
    price_cents: 15000,
    payment_status: "unpaid",
    status: "scheduled",
    ...over,
  });

  it("counts an invoiced, unpaid, scheduled interview", () => {
    expect(isOutstandingInvoice(base({}))).toBe(true);
  });
  it("does NOT count a cancelled invoice (the reported bug)", () => {
    expect(isOutstandingInvoice(base({ status: "cancelled" }))).toBe(false);
  });
  it("does NOT count a rejected invoice", () => {
    expect(isOutstandingInvoice(base({ status: "rejected" }))).toBe(false);
  });
  it("does NOT count a still-pending invoice", () => {
    expect(isOutstandingInvoice(base({ status: "pending" }))).toBe(false);
  });
  it("does NOT count an already-paid invoice", () => {
    expect(isOutstandingInvoice(base({ payment_status: "paid" }))).toBe(false);
  });
  it("does NOT count an un-invoiced interview (no price)", () => {
    expect(isOutstandingInvoice(base({ price_cents: null }))).toBe(false);
  });
});
