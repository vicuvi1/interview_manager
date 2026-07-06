"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * Watches app_settings.app_version. When an admin bumps it (via the App version
 * card), every open client sees an "Update now" banner and can reload to the
 * latest deploy. Uses Realtime for instant delivery + a 60s poll fallback.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const loaded = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function readVersion(): Promise<string | null | undefined> {
      const { data, error } = await supabase.from("app_settings").select("app_version").eq("id", 1).maybeSingle();
      if (error) return undefined; // column/table not ready — ignore
      return (data as { app_version?: string | null } | null)?.app_version ?? null;
    }

    async function check() {
      const v = await readVersion();
      if (cancelled || v === undefined) return;
      if (!primed.current) {
        loaded.current = v;
        primed.current = true;
        return;
      }
      if (v !== loaded.current) setStale(true);
    }

    check();
    const channel = supabase
      .channel("app-version")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: "id=eq.1" }, check)
      .subscribe();
    const poll = window.setInterval(check, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="sticky top-[52px] z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#6366f1] px-4 py-2 text-[13px] font-medium text-white">
      A new version of the app is available.
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 transition-colors hover:bg-white/30"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Update now
      </button>
    </div>
  );
}
