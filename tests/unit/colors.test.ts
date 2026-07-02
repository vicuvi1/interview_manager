import { describe, expect, it } from "vitest";

import { colorBg, EVENT_COLORS } from "@/lib/colors";

describe("colorBg", () => {
  it("converts a hex color to an rgba string with the given alpha", () => {
    expect(colorBg("#10b981", 0.3)).toBe("rgba(16,185,129,0.3)");
  });
  it("uses the default alpha when omitted", () => {
    expect(colorBg("#000000")).toBe("rgba(0,0,0,0.22)");
  });
  it("handles full-white", () => {
    expect(colorBg("#ffffff", 1)).toBe("rgba(255,255,255,1)");
  });
});

describe("EVENT_COLORS", () => {
  it("are all valid 6-digit hex values", () => {
    expect(EVENT_COLORS.length).toBeGreaterThan(0);
    for (const c of EVENT_COLORS) {
      expect(c.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});
