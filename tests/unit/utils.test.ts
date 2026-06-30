import { describe, expect, it } from "vitest";

import { formatMoney, initials } from "@/lib/utils";

describe("formatMoney", () => {
  it("formats cents as currency", () => {
    expect(formatMoney(15000, "USD")).toContain("150.00");
  });

  it("returns a dash for null", () => {
    expect(formatMoney(null)).toBe("—");
  });
});

describe("initials", () => {
  it("uses first + last from a full name", () => {
    expect(initials("Ada Lovelace", null)).toBe("AL");
  });

  it("falls back to the email", () => {
    expect(initials(null, "grace@example.com")).toBe("G");
  });

  it("returns ? when nothing is provided", () => {
    expect(initials(null, null)).toBe("?");
  });
});
