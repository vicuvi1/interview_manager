"use client";

import { useEffect } from "react";

// A tiny same-tab event bus so a user's own action (request / cancel / pay)
// refreshes every card immediately, without waiting on a Supabase Realtime
// round-trip. Realtime still handles cross-user / cross-tab updates.
const EVENT = "im:data-changed";

export function notifyChanged(topic: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: topic }));
  }
}

export function useDataChanged(topic: string, handler: () => void): void {
  useEffect(() => {
    const fn = (e: Event) => {
      if ((e as CustomEvent<string>).detail === topic) handler();
    };
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
  }, [topic, handler]);
}
