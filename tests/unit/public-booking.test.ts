import { describe, expect, it } from "vitest";

import { MIN_ELAPSED_MS, vetSubmission } from "@/lib/public-booking";

const valid = {
  name: "Jane Doe",
  email: "jane@example.com",
  role: "Frontend Engineer",
  elapsedMs: MIN_ELAPSED_MS + 1000,
};

describe("vetSubmission — anti-spam", () => {
  it("silently drops when the honeypot is filled", () => {
    const r = vetSubmission({ ...valid, website: "http://spam" });
    expect(r).toEqual({ ok: false, drop: true });
  });

  it("silently drops a submission faster than the minimum", () => {
    const r = vetSubmission({ ...valid, elapsedMs: 500 });
    expect(r).toEqual({ ok: false, drop: true });
  });

  it("allows a submission with no timing info (elapsedMs missing)", () => {
    const r = vetSubmission({ name: "Jo", email: "a@b.co", role: "Dev" });
    expect(r.ok).toBe(true);
  });
});

describe("vetSubmission — validation", () => {
  it("rejects a short name with a user-facing error", () => {
    const r = vetSubmission({ ...valid, name: "J" });
    expect(r).toMatchObject({ ok: false, drop: false });
  });

  it("rejects an invalid email", () => {
    const r = vetSubmission({ ...valid, email: "not-an-email" });
    expect(r).toMatchObject({ ok: false, drop: false });
  });

  it("rejects a missing role", () => {
    const r = vetSubmission({ ...valid, role: "" });
    expect(r).toMatchObject({ ok: false, drop: false });
  });
});

describe("vetSubmission — accept + normalize", () => {
  it("trims and returns normalized values", () => {
    const r = vetSubmission({ ...valid, name: "  Jane  ", email: "  JANE@x.io ", role: " Dev " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.name).toBe("Jane");
      expect(r.values.email).toBe("JANE@x.io");
      expect(r.values.role).toBe("Dev");
    }
  });

  it("caps overly long fields", () => {
    const r = vetSubmission({ ...valid, notes: "x".repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.notes?.length).toBe(2000);
  });

  it("passes optional fields through as null when absent", () => {
    const r = vetSubmission(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.preferred_at).toBeNull();
      expect(r.values.timezone).toBeNull();
      expect(r.values.notes).toBeNull();
    }
  });
});
