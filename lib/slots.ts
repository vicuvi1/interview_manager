/** Time-slot helpers for the scheduler (recurrence expansion + overlap). */

const DAY = 86400000;

/** Expand a (possibly recurring) interval into concrete occurrences within a range. */
export function expandRecurring(
  anchorStart: number,
  anchorEnd: number,
  rule: string,
  rangeStart: number,
  rangeEnd: number,
): Array<{ s: number; e: number }> {
  const duration = Math.max(0, anchorEnd - anchorStart);
  if (rule !== "daily" && rule !== "weekly") {
    if (anchorEnd >= rangeStart && anchorStart <= rangeEnd) return [{ s: anchorStart, e: anchorEnd }];
    return [];
  }
  const interval = rule === "daily" ? DAY : 7 * DAY;
  const out: Array<{ s: number; e: number }> = [];
  let k = Math.max(0, Math.floor((rangeStart - anchorEnd) / interval));
  for (let i = 0; i < 400; i++, k++) {
    const s = anchorStart + k * interval;
    if (s > rangeEnd) break;
    const e = s + duration;
    if (e >= rangeStart) out.push({ s, e });
  }
  return out;
}

/** Do [aStart,aEnd) and [bStart,bEnd) overlap? */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Is [start,end) fully inside any of the given intervals? */
export function within(start: number, end: number, intervals: Array<{ s: number; e: number }>): boolean {
  return intervals.some((iv) => start >= iv.s && end <= iv.e);
}
