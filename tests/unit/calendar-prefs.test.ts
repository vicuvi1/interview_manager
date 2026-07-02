import { describe, expect, it } from "vitest";

import { hourStr, timeFormat, timezoneList } from "@/lib/calendar-prefs";

describe("hourStr", () => {
  it("zero-pads to an HH:00:00 slot time", () => {
    expect(hourStr(7)).toBe("07:00:00");
    expect(hourStr(21)).toBe("21:00:00");
    expect(hourStr(0)).toBe("00:00:00");
  });
  it("clamps out-of-range hours", () => {
    expect(hourStr(-3)).toBe("00:00:00");
    expect(hourStr(48)).toBe("24:00:00");
  });
});

describe("timeFormat", () => {
  it("honors the 12/24h preference", () => {
    expect(timeFormat(true).hour12).toBe(true);
    expect(timeFormat(false).hour12).toBe(false);
    expect(timeFormat(true).minute).toBe("2-digit");
  });
});

describe("timezoneList", () => {
  it("returns a non-empty list of timezone strings", () => {
    const zones = timezoneList();
    expect(zones.length).toBeGreaterThan(0);
    expect(typeof zones[0]).toBe("string");
    // A well-known zone should be present in either the native or fallback list.
    expect(zones.some((z) => z.includes("London") || z === "UTC")).toBe(true);
  });
});
