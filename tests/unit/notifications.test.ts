import { describe, expect, it } from "vitest";

import { notifMeta, notifTypeLabel } from "@/lib/notifications";

describe("notifMeta", () => {
  it("returns the meta for a known type", () => {
    expect(notifMeta("success").tone).toBe("green");
    expect(notifMeta("rejected").tone).toBe("red");
  });
  it("falls back to info for unknown types", () => {
    expect(notifMeta("totally-unknown").tone).toBe(notifMeta("info").tone);
  });
  it("always returns an icon", () => {
    expect(notifMeta("whatever").icon).toBeTruthy();
  });
});

describe("notifTypeLabel", () => {
  it("labels known types", () => {
    expect(notifTypeLabel("approved")).toBe("Scheduling");
  });
  it("defaults to Info", () => {
    expect(notifTypeLabel("nope")).toBe("Info");
  });
});
