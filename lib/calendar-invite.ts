/** Helpers to add a scheduled interview to an external calendar. */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as a UTC calendar stamp: YYYYMMDDTHHMMSSZ. */
function stampUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

interface InviteInput {
  title: string;
  startISO: string;
  durationMin: number;
  details?: string | null;
  location?: string | null;
}

function bounds(startISO: string, durationMin: number): { start: Date; end: Date } {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + Math.max(5, durationMin) * 60000);
  return { start, end };
}

/** A "click to add" Google Calendar URL. */
export function googleCalendarUrl({ title, startISO, durationMin, details, location }: InviteInput): string {
  const { start, end } = bounds(startISO, durationMin);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stampUTC(start)}/${stampUTC(end)}`,
  });
  if (details) params.set("details", details);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** A full .ics file body (Apple/Outlook/etc.). */
export function icsContent({ title, startISO, durationMin, details, location }: InviteInput): string {
  const { start, end } = bounds(startISO, durationMin);
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const uid = `${stampUTC(start)}-${Math.abs(hashCode(title))}@interview-manager`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Interview Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stampUTC(start)}`,
    `DTSTART:${stampUTC(start)}`,
    `DTEND:${stampUTC(end)}`,
    `SUMMARY:${esc(title)}`,
    details ? `DESCRIPTION:${esc(details)}` : "",
    location ? `LOCATION:${esc(location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

/** Trigger a browser download of an .ics file for the given invite. */
export function downloadIcs(input: InviteInput, filename = "interview.ics"): void {
  const blob = new Blob([icsContent(input)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
