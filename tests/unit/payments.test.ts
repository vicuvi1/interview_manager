import { describe, expect, it } from "vitest";

import { METHOD_LABEL, PAYMENT_STATUS_TONE, formatAmount } from "@/lib/payments";

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
