"use client";

import { useEffect, useState } from "react";

/**
 * Sizes a calendar grid to fill the available viewport height instead of a
 * fixed pixel value, so more of the day is visible without scrolling.
 *
 * `offset` is the vertical space (px) taken up by everything around the grid
 * on that page — page padding, the calendar toolbar, and the legend/filter row
 * below it. `min` keeps the grid usable on short windows (it will scroll
 * internally once it hits the floor).
 */
export function useCalendarHeight(offset = 220, min = 640): number {
  // Before mount we don't know the viewport; fall back to a tall default so the
  // first paint (and SSR skeleton) roughly matches the mounted size.
  const [height, setHeight] = useState(880);

  useEffect(() => {
    const compute = () => setHeight(Math.max(min, window.innerHeight - offset));
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [offset, min]);

  return height;
}
