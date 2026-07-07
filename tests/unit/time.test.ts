import { describe, expect, it } from "vitest";

import { formatInTimeZone, relativeTime, utcToLocalInput, wallTimeToUtcISO } from "@/lib/time";

describe("wallTimeToUtcISO — standard offsets", () => {
  it("converts a New York wall time to UTC (EDT is -4)", () => {
    expect(wallTimeToUtcISO("2026-07-15T14:00", "America/New_York")).toBe(
      "2026-07-15T18:00:00.000Z",
    );
  });

  it("converts a New York winter wall time to UTC (EST is -5)", () => {
    expect(wallTimeToUtcISO("2026-01-15T14:00", "America/New_York")).toBe(
      "2026-01-15T19:00:00.000Z",
    );
  });

  it("converts a Tokyo wall time to UTC (+9, no DST)", () => {
    expect(wallTimeToUtcISO("2026-07-15T09:00", "Asia/Tokyo")).toBe(
      "2026-07-15T00:00:00.000Z",
    );
  });

  it("treats a UTC wall time as-is", () => {
    expect(wallTimeToUtcISO("2026-07-15T09:00", "UTC")).toBe(
      "2026-07-15T09:00:00.000Z",
    );
  });

  it("handles a positive offset with a half-hour component (IST +5:30)", () => {
    expect(wallTimeToUtcISO("2026-07-15T12:00", "Asia/Kolkata")).toBe(
      "2026-07-15T06:30:00.000Z",
    );
  });

  it("defaults a missing time component to midnight", () => {
    expect(wallTimeToUtcISO("2026-07-15", "UTC")).toBe("2026-07-15T00:00:00.000Z");
  });
});

// Regression tests for the single-pass DST bug: wall times within the UTC
// offset's distance of a transition were resolved with the wrong offset and
// came out exactly one DST-gap off. These cover both sides of both US
// transitions plus EU and Southern-hemisphere zones.
describe("wallTimeToUtcISO — DST boundaries (regression)", () => {
  // US spring forward 2026: Mar 8, clocks jump 02:00 EST -> 03:00 EDT.
  it("resolves the morning after US spring-forward at EDT, not EST", () => {
    // 05:00 EDT (-4) => 09:00Z. The single-pass bug produced 10:00Z.
    expect(wallTimeToUtcISO("2026-03-08T05:00", "America/New_York")).toBe(
      "2026-03-08T09:00:00.000Z",
    );
  });

  it("resolves a wall time just after the spring-forward gap correctly", () => {
    // 03:30 EDT (-4) => 07:30Z.
    expect(wallTimeToUtcISO("2026-03-08T03:30", "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("resolves a wall time just before the spring-forward gap at EST", () => {
    // 01:30 EST (-5) => 06:30Z.
    expect(wallTimeToUtcISO("2026-03-08T01:30", "America/New_York")).toBe(
      "2026-03-08T06:30:00.000Z",
    );
  });

  // US fall back 2026: Nov 1, clocks fall 02:00 EDT -> 01:00 EST.
  it("resolves the morning after US fall-back at EST, not EDT", () => {
    // 05:00 EST (-5) => 10:00Z. The single-pass bug produced 09:00Z.
    expect(wallTimeToUtcISO("2026-11-01T05:00", "America/New_York")).toBe(
      "2026-11-01T10:00:00.000Z",
    );
  });

  // EU transitions differ from the US by weeks — worth covering independently.
  it("resolves a London wall time after EU spring-forward (BST +1)", () => {
    // EU springs forward Mar 29 2026 01:00 UTC. 05:30 BST (+1) => 04:30Z.
    expect(wallTimeToUtcISO("2026-03-29T05:30", "Europe/London")).toBe(
      "2026-03-29T04:30:00.000Z",
    );
  });

  it("resolves a London wall time after EU fall-back (GMT +0)", () => {
    // EU falls back Oct 25 2026 01:00 UTC. 05:00 GMT (+0) => 05:00Z.
    expect(wallTimeToUtcISO("2026-10-25T05:00", "Europe/London")).toBe(
      "2026-10-25T05:00:00.000Z",
    );
  });

  it("resolves a Southern-hemisphere transition (Sydney fall-back)", () => {
    // Sydney falls back Apr 5 2026 03:00 -> 02:00 (AEDT +11 -> AEST +10).
    // 05:00 AEST (+10) => previous day 19:00Z.
    expect(wallTimeToUtcISO("2026-04-05T05:00", "Australia/Sydney")).toBe(
      "2026-04-04T19:00:00.000Z",
    );
  });
});

describe("utcToLocalInput", () => {
  it("renders a UTC instant as a datetime-local value in the zone", () => {
    expect(utcToLocalInput("2026-07-15T18:00:00.000Z", "America/New_York")).toBe(
      "2026-07-15T14:00",
    );
  });

  it("renders across a day boundary in a far-east zone", () => {
    expect(utcToLocalInput("2026-07-15T20:00:00.000Z", "Asia/Tokyo")).toBe(
      "2026-07-16T05:00",
    );
  });

  it("renders a winter (EST) instant", () => {
    expect(utcToLocalInput("2026-01-15T19:00:00.000Z", "America/New_York")).toBe(
      "2026-01-15T14:00",
    );
  });

  it("returns empty for missing input", () => {
    expect(utcToLocalInput(null, "UTC")).toBe("");
  });

  it("returns empty for an invalid ISO string", () => {
    expect(utcToLocalInput("not-a-date", "UTC")).toBe("");
  });
});

// The scheduling and reschedule dialogs round-trip through both functions:
// a datetime-local value -> UTC (store) -> datetime-local value (re-render).
// The output wall time must equal the input for every valid wall time.
describe("wallTimeToUtcISO <-> utcToLocalInput round-trip", () => {
  const zones = ["UTC", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Sydney"];
  const walls = [
    "2026-07-15T14:00", // summer, unambiguous
    "2026-01-15T09:30", // winter, unambiguous
    "2026-03-08T05:00", // day of US spring-forward
    "2026-11-01T05:00", // day of US fall-back
    "2026-03-29T05:30", // day of EU spring-forward
    "2026-10-25T05:00", // day of EU fall-back
  ];
  for (const tz of zones) {
    for (const wall of walls) {
      it(`round-trips ${wall} in ${tz}`, () => {
        const iso = wallTimeToUtcISO(wall, tz);
        expect(utcToLocalInput(iso, tz)).toBe(wall);
      });
    }
  }
});

describe("formatInTimeZone", () => {
  it("returns an em dash for null", () => {
    expect(formatInTimeZone(null, "UTC")).toBe("—");
  });

  it("returns an em dash for an invalid instant", () => {
    expect(formatInTimeZone("nope", "America/New_York")).toBe("—");
  });

  it("does not throw on a bad timezone (falls back to local formatting)", () => {
    expect(() => formatInTimeZone("2026-07-15T18:00:00.000Z", "Not/AZone")).not.toThrow();
  });
});

describe("relativeTime", () => {
  it("is 'just now' for the current moment", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
  });

  it("renders minutes for a few minutes ago", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("renders hours for a few hours ago", () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });

  it("is empty for null", () => {
    expect(relativeTime(null)).toBe("");
  });

  it("is empty for an invalid date", () => {
    expect(relativeTime("not-a-date")).toBe("");
  });

  it("renders days within a week", () => {
    expect(relativeTime(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3d ago");
  });

  // The optional timeZone controls the absolute-date fallback (> 1 week old).
  it("resolves the fallback date in the given timezone", () => {
    const iso = "2020-01-01T00:30:00.000Z"; // near midnight UTC, long ago
    const utc = relativeTime(iso, "UTC");
    const honolulu = relativeTime(iso, "Pacific/Honolulu"); // UTC-10 → previous calendar day
    expect(utc).not.toBe("");
    expect(honolulu).not.toBe("");
    expect(utc).not.toBe(honolulu);
  });
});
