import { describe, expect, it } from "vitest";

import { relativeTime, utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";

describe("wallTimeToUtcISO", () => {
  it("converts a New York wall time to UTC (EDT is -4)", () => {
    expect(wallTimeToUtcISO("2026-07-15T14:00", "America/New_York")).toBe(
      "2026-07-15T18:00:00.000Z",
    );
  });

  it("converts a Tokyo wall time to UTC (+9)", () => {
    expect(wallTimeToUtcISO("2026-07-15T09:00", "Asia/Tokyo")).toBe(
      "2026-07-15T00:00:00.000Z",
    );
  });
});

describe("utcToLocalInput", () => {
  it("renders a UTC instant as a datetime-local value in the zone", () => {
    expect(utcToLocalInput("2026-07-15T18:00:00.000Z", "America/New_York")).toBe(
      "2026-07-15T14:00",
    );
  });

  it("returns empty for missing input", () => {
    expect(utcToLocalInput(null, "UTC")).toBe("");
  });
});

describe("relativeTime", () => {
  it("is 'just now' for the current moment", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
  });

  it("is empty for null", () => {
    expect(relativeTime(null)).toBe("");
  });
});
