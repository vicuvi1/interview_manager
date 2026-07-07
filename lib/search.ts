/** Free-text search helpers shared by the admin consoles. */

import type { InterviewRequest } from "./types";

/**
 * Case-insensitive, multi-term "AND" matcher. Every whitespace-separated term
 * in the query must appear somewhere in the haystack, so "acme senior" matches a
 * row that mentions Acme and a senior role in any field, in any order. An empty
 * query matches everything.
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/**
 * Everything about an interview worth searching, flattened into one string.
 * Includes the dedicated `company` field AND the free-text fields (role, notes,
 * caller notes, goals, focus areas), so a company mentioned only in the notes is
 * still found — the "smart" part of the search. Pass the resolved candidate name
 * / email (the row only stores an id) so people can be found by name too.
 */
export function interviewHaystack(
  r: Pick<
    InterviewRequest,
    "role" | "company" | "interviewer_name" | "interview_type" | "level" | "notes" | "caller_notes" | "goals" | "focus_areas"
  >,
  candidateName?: string | null,
  candidateEmail?: string | null,
): string {
  return [
    candidateName,
    candidateEmail,
    r.role,
    r.company,
    r.interviewer_name,
    r.interview_type,
    r.level,
    r.notes,
    r.caller_notes,
    r.goals,
    (r.focus_areas ?? []).join(" "),
  ]
    .filter(Boolean)
    .join("   ");
}
