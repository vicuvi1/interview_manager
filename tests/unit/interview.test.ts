import { describe, expect, it } from "vitest";

import { DEFAULT_DURATIONS, defaultDurationFor, durationOptions } from "@/lib/interview";

describe("durationOptions", () => {
  it("falls back to defaults when none configured", () => {
    expect(durationOptions(null)).toEqual(DEFAULT_DURATIONS);
    expect(durationOptions([])).toEqual(DEFAULT_DURATIONS);
  });
  it("sorts, de-dupes, and drops non-positive values", () => {
    expect(durationOptions([60, 15, 15, 30, 0, -5, 60])).toEqual([15, 30, 60]);
  });
  it("keeps a custom set", () => {
    expect(durationOptions([20, 40])).toEqual([20, 40]);
  });
  it("can inject the current value so a select always shows it", () => {
    expect(durationOptions([30, 60, 25])).toEqual([25, 30, 60]);
  });
});

describe("defaultDurationFor", () => {
  const map = { Technical: 60, Screening: 20 };
  it("returns the per-type override when set", () => {
    expect(defaultDurationFor("Technical", map)).toBe(60);
    expect(defaultDurationFor("Screening", map)).toBe(20);
  });
  it("falls back to 30 for unknown types", () => {
    expect(defaultDurationFor("Panel", map)).toBe(30);
  });
  it("falls back for null/empty map", () => {
    expect(defaultDurationFor(null, map)).toBe(30);
    expect(defaultDurationFor("Technical", null)).toBe(30);
  });
  it("honors a custom fallback", () => {
    expect(defaultDurationFor("Panel", map, 45)).toBe(45);
  });
  it("ignores non-positive overrides", () => {
    expect(defaultDurationFor("Weird", { Weird: 0 })).toBe(30);
  });
});
