import { describe, expect, it } from "vitest";

import { DEFAULT_STATUS_COLORS, DEFAULT_STATUS_LABELS, statusColor, statusLabel } from "@/lib/status";

describe("statusLabel", () => {
  it("uses the admin override when present", () => {
    expect(statusLabel("pending", { pending: "Awaiting confirmation" })).toBe("Awaiting confirmation");
  });
  it("trims overrides and ignores blank ones", () => {
    expect(statusLabel("pending", { pending: "  Queued  " })).toBe("Queued");
    expect(statusLabel("pending", { pending: "   " })).toBe(DEFAULT_STATUS_LABELS.pending);
  });
  it("falls back to the default label", () => {
    expect(statusLabel("approved", {})).toBe("Approved");
    expect(statusLabel("scheduled", null)).toBe("Scheduled");
  });
  it("returns the raw key for unknown statuses", () => {
    expect(statusLabel("weird", {})).toBe("weird");
  });
  it("is empty for nullish", () => {
    expect(statusLabel(null)).toBe("");
  });
});

describe("statusColor", () => {
  it("uses a valid hex override", () => {
    expect(statusColor("pending", { pending: "#123abc" })).toBe("#123abc");
    expect(statusColor("pending", { pending: "#fff" })).toBe("#fff");
  });
  it("ignores an invalid override and falls back to default", () => {
    expect(statusColor("pending", { pending: "notacolor" })).toBe(DEFAULT_STATUS_COLORS.pending);
    expect(statusColor("pending", { pending: "red" })).toBe(DEFAULT_STATUS_COLORS.pending);
  });
  it("falls back to defaults", () => {
    expect(statusColor("completed", {})).toBe(DEFAULT_STATUS_COLORS.completed);
  });
  it("returns neutral gray for unknown/nullish", () => {
    expect(statusColor("weird", {})).toBe("#9ca3af");
    expect(statusColor(null)).toBe("#9ca3af");
  });
});
