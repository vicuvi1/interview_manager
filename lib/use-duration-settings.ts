"use client";

import { useEffect, useState } from "react";

import { DEFAULT_DURATIONS, type DurationMap, durationOptions } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";

/**
 * Loads the admin-configured duration options + per-type default durations from
 * app_settings. Falls back to sensible defaults so callers always have a list.
 */
export function useDurationSettings() {
  const [options, setOptions] = useState<number[]>(DEFAULT_DURATIONS);
  const [typeDurations, setTypeDurations] = useState<DurationMap>({});

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("duration_options, type_durations")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setOptions(durationOptions((data as { duration_options?: number[] }).duration_options));
        setTypeDurations(((data as { type_durations?: DurationMap }).type_durations) ?? {});
      }
    })();
  }, []);

  return { options, typeDurations };
}
