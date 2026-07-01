import type { InterviewRequest, Payment } from "@/lib/types";

/** Count of requests grouped by status. */
export function statusCounts(requests: InterviewRequest[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
}

export interface FunnelStage {
  label: string;
  value: number;
}

/**
 * Request → Approved → Scheduled → Completed. Each stage counts requests that
 * reached at least that point, so the funnel is monotonically non-increasing.
 */
export function computeFunnel(requests: InterviewRequest[]): FunnelStage[] {
  const approved = requests.filter((r) => ["approved", "scheduled", "completed"].includes(r.status)).length;
  const scheduled = requests.filter((r) => ["scheduled", "completed"].includes(r.status)).length;
  const completed = requests.filter((r) => r.status === "completed").length;
  return [
    { label: "Requested", value: requests.length },
    { label: "Approved", value: approved },
    { label: "Scheduled", value: scheduled },
    { label: "Completed", value: completed },
  ];
}

/** Percentage (0–100) of requests that reached "completed". */
export function completionRate(requests: InterviewRequest[]): number {
  if (requests.length === 0) return 0;
  const completed = requests.filter((r) => r.status === "completed").length;
  return Math.round((completed / requests.length) * 100);
}

/** Sum of all paid payments (amounts are dollars, stored as numeric → string). */
export function sumPaid(payments: Payment[]): number {
  return payments.filter((p) => p.status === "paid").reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Previous "YYYY-MM" for a given "YYYY-MM". */
export function prevMonthKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The last `count` "YYYY-MM" keys ending at (and including) `end`, oldest first. */
export function lastMonths(end: string, count: number): string[] {
  const out: string[] = [];
  let mk = end;
  for (let i = 0; i < count; i++) {
    out.unshift(mk);
    mk = prevMonthKey(mk);
  }
  return out;
}
