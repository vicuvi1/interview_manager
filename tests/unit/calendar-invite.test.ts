import { describe, expect, it } from "vitest";

import { googleCalendarUrl, icsContent } from "@/lib/calendar-invite";

const START = "2026-07-02T14:00:00.000Z";

describe("googleCalendarUrl", () => {
  it("builds a render URL with UTC start/end stamps", () => {
    const url = googleCalendarUrl({ title: "Interview: Role", startISO: START, durationMin: 30 });
    expect(url).toContain("https://calendar.google.com/calendar/render");
    expect(url).toContain("action=TEMPLATE");
    // 14:00Z + 30m → 14:30Z
    expect(url).toContain("dates=20260702T140000Z%2F20260702T143000Z");
  });

  it("includes details and location when provided", () => {
    const url = googleCalendarUrl({
      title: "T",
      startISO: START,
      durationMin: 60,
      details: "hello world",
      location: "https://meet.example/x",
    });
    expect(url).toContain("details=hello");
    expect(url).toContain("location=https");
  });

  it("clamps a sub-minimum duration to at least 5 minutes", () => {
    const url = googleCalendarUrl({ title: "T", startISO: START, durationMin: 1 });
    expect(url).toContain("dates=20260702T140000Z%2F20260702T140500Z");
  });
});

describe("icsContent", () => {
  it("produces a valid VEVENT with UTC times", () => {
    const ics = icsContent({ title: "Interview", startISO: START, durationMin: 45, location: "Zoom" });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Interview");
    expect(ics).toContain("DTSTART:20260702T140000Z");
    expect(ics).toContain("DTEND:20260702T144500Z");
    expect(ics).toContain("LOCATION:Zoom");
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("escapes commas and semicolons in text fields", () => {
    const ics = icsContent({ title: "A, B; C", startISO: START, durationMin: 30 });
    expect(ics).toContain("SUMMARY:A\\, B\\; C");
  });
});
