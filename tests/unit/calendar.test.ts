import { describe, expect, it } from "vitest";

import { buildMonth, dateKeyInTimeZone, formatDateKey } from "@/lib/calendar";

describe("dateKeyInTimeZone", () => {
  it("uses the local calendar date of the zone", () => {
    // 2026-07-15T00:00Z is still the 14th in New York (20:00 the prior day).
    expect(dateKeyInTimeZone("2026-07-15T00:00:00.000Z", "America/New_York")).toBe(
      "2026-07-14",
    );
    expect(dateKeyInTimeZone("2026-07-15T00:00:00.000Z", "Asia/Tokyo")).toBe("2026-07-15");
  });
});

describe("buildMonth", () => {
  it("returns a 42-cell grid with the right in-month days", () => {
    const cells = buildMonth(2026, 6); // July 2026 (31 days)
    expect(cells).toHaveLength(42);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.some((c) => c.day === 1 && c.inMonth)).toBe(true);
  });
});

describe("formatDateKey", () => {
  it("formats a date key to a readable label", () => {
    expect(formatDateKey("2026-07-04")).toContain("Jul");
  });
});
