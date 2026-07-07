import { describe, expect, it } from "vitest";

import { interviewHaystack, matchesSearch } from "@/lib/search";
import type { InterviewRequest } from "@/lib/types";

const base: Pick<
  InterviewRequest,
  "role" | "company" | "interviewer_name" | "interview_type" | "level" | "notes" | "caller_notes" | "goals" | "focus_areas"
> = {
  role: "Senior Node.js Developer",
  company: null,
  interviewer_name: null,
  interview_type: "Technical",
  level: "Senior",
  notes: null,
  caller_notes: null,
  goals: null,
  focus_areas: null,
};

describe("matchesSearch", () => {
  it("matches everything on an empty / whitespace query", () => {
    expect(matchesSearch("anything", "")).toBe(true);
    expect(matchesSearch("anything", "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch("Acme Corp", "acme")).toBe(true);
    expect(matchesSearch("acme corp", "ACME")).toBe(true);
  });

  it("requires ALL terms to be present, in any order", () => {
    expect(matchesSearch("Acme senior node developer", "acme senior")).toBe(true);
    expect(matchesSearch("Acme senior node developer", "senior acme")).toBe(true);
    expect(matchesSearch("Acme junior role", "acme senior")).toBe(false);
  });
});

describe("interviewHaystack", () => {
  it("finds a company from the dedicated field", () => {
    const hay = interviewHaystack({ ...base, company: "Acme Corp" }, "Jane Doe", "jane@x.com");
    expect(matchesSearch(hay, "acme")).toBe(true);
  });

  it("finds a company mentioned only in the notes (smart search)", () => {
    const hay = interviewHaystack({ ...base, notes: "Interviewing at Acme next week" });
    expect(matchesSearch(hay, "acme")).toBe(true);
  });

  it("finds a row by the interviewer's name", () => {
    const hay = interviewHaystack({ ...base, interviewer_name: "Jordan Lee" });
    expect(matchesSearch(hay, "jordan")).toBe(true);
  });

  it("finds a company mentioned only in caller notes, goals, or focus areas", () => {
    expect(matchesSearch(interviewHaystack({ ...base, caller_notes: "role at Globex" }), "globex")).toBe(true);
    expect(matchesSearch(interviewHaystack({ ...base, goals: "land the Initech offer" }), "initech")).toBe(true);
    expect(matchesSearch(interviewHaystack({ ...base, focus_areas: ["React", "Umbrella Inc"] }), "umbrella")).toBe(true);
  });

  it("finds a row by candidate name or email", () => {
    const hay = interviewHaystack(base, "Jane Doe", "jane@example.com");
    expect(matchesSearch(hay, "jane")).toBe(true);
    expect(matchesSearch(hay, "example.com")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    const hay = interviewHaystack({ ...base, company: "Acme" }, "Jane Doe");
    expect(matchesSearch(hay, "microsoft")).toBe(false);
  });
});
