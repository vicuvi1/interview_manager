/** Personal, per-browser calendar display preferences for candidates. */

export interface CalendarPrefs {
  /** 12-hour (AM/PM) vs 24-hour clock. */
  hour12: boolean;
  /** First day of the week: 0 = Sunday, 1 = Monday. */
  weekStart: number;
  /** First visible hour in day/week grids (0–23). */
  dayStart: number;
  /** Last visible hour in day/week grids (1–24). */
  dayEnd: number;
}

export const DEFAULT_PREFS: CalendarPrefs = {
  hour12: true,
  weekStart: 0,
  dayStart: 7,
  dayEnd: 21,
};

const KEY = "cal-prefs-v1";

export function loadPrefs(): CalendarPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<CalendarPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: CalendarPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

/** "07:00:00" for FullCalendar slotMin/MaxTime. */
export function hourStr(h: number): string {
  return `${String(Math.max(0, Math.min(24, h))).padStart(2, "0")}:00:00`;
}

/** FullCalendar time-format object honoring the 12/24h preference. */
export function timeFormat(hour12: boolean) {
  return { hour: "numeric" as const, minute: "2-digit" as const, hour12 };
}
