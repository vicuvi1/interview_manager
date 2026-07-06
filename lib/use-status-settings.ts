"use client";

import { useEffect, useState } from "react";

import type { StatusColorMap, StatusLabelMap } from "@/lib/status";
import { createClient } from "@/lib/supabase/client";

export interface StatusSettings {
  labels: StatusLabelMap;
  colors: StatusColorMap;
}

// Module-level cache so the dozens of status badges on a page share ONE fetch.
let cache: StatusSettings | null = null;
let inflight: Promise<StatusSettings> | null = null;

function fetchOnce(): Promise<StatusSettings> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("status_labels, status_colors")
        .eq("id", 1)
        .maybeSingle();
      cache = {
        labels: (data as { status_labels?: StatusLabelMap } | null)?.status_labels ?? {},
        colors: (data as { status_colors?: StatusColorMap } | null)?.status_colors ?? {},
      };
      return cache;
    })();
  }
  return inflight;
}

/** Admin-configured status labels + colors (falls back to defaults). */
export function useStatusSettings(): StatusSettings {
  const [settings, setSettings] = useState<StatusSettings>(cache ?? { labels: {}, colors: {} });
  useEffect(() => {
    let live = true;
    fetchOnce().then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return settings;
}

/** Call after saving status settings so open views pick up the change without a reload. */
export function invalidateStatusSettings() {
  cache = null;
  inflight = null;
}
