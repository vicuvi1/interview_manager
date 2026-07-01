import { describe, expect, it } from "vitest";

import { formatBytes, formatMoney, initials } from "@/lib/utils";

describe("formatMoney", () => {
  it("formats cents as currency", () => {
    expect(formatMoney(15000, "USD")).toContain("150.00");
  });

  it("returns a dash for null", () => {
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("formats megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("handles null", () => {
    expect(formatBytes(null)).toBe("0 B");
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
