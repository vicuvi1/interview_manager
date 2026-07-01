import { describe, expect, it } from "vitest";

import { expandRecurring, overlaps, within } from "@/lib/slots";

const HOUR = 3600000;
const DAY = 86400000;

describe("overlaps", () => {
  it("detects overlapping intervals", () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
    expect(overlaps(5, 15, 0, 10)).toBe(true);
  });
  it("treats touching edges as non-overlapping", () => {
    expect(overlaps(0, 10, 10, 20)).toBe(false);
  });
  it("returns false for disjoint intervals", () => {
    expect(overlaps(0, 10, 20, 30)).toBe(false);
  });
});

describe("within", () => {
  const intervals = [{ s: 100, e: 200 }, { s: 300, e: 400 }];
  it("is true when fully inside one interval", () => {
    expect(within(120, 180, intervals)).toBe(true);
  });
  it("is false when straddling a boundary", () => {
    expect(within(180, 260, intervals)).toBe(false);
  });
  it("is false when outside every interval", () => {
    expect(within(500, 600, intervals)).toBe(false);
  });
});

describe("expandRecurring", () => {
  it("returns a one-time interval when it overlaps the range", () => {
    const occ = expandRecurring(1000, 1000 + HOUR, "none", 0, DAY);
    expect(occ).toEqual([{ s: 1000, e: 1000 + HOUR }]);
  });

  it("drops a one-time interval outside the range", () => {
    const occ = expandRecurring(10 * DAY, 10 * DAY + HOUR, "none", 0, DAY);
    expect(occ).toHaveLength(0);
  });

  it("expands a daily rule across the range", () => {
    // anchor at day 0, range covers days 0..3 → 4 occurrences
    const occ = expandRecurring(0, HOUR, "daily", 0, 3 * DAY + HOUR);
    expect(occ).toHaveLength(4);
    expect(occ[1].s).toBe(DAY);
  });

  it("expands a weekly rule and skips weeks before the range", () => {
    // anchor at day 0, range starts at day 14 → first occurrence is week 2
    const occ = expandRecurring(0, HOUR, "weekly", 14 * DAY, 21 * DAY + HOUR);
    expect(occ.length).toBeGreaterThan(0);
    expect(occ[0].s).toBe(14 * DAY);
  });
});
