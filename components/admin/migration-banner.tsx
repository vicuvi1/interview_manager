"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

// One probe per recent schema migration: if the column/table is missing, that
// migration hasn't been applied. Admin-readable objects only (no false negatives).
const MARKERS: { key: string; table: string; col: string }[] = [
  { key: "0041", table: "public_booking_requests", col: "ip_hash" },
  { key: "0039", table: "profiles", col: "calendar_color" },
  { key: "0038", table: "app_feedback", col: "id" },
  { key: "0035", table: "candidate_availability", col: "id" },
  { key: "0033", table: "interview_pricing", col: "interview_type" },
];

export function MigrationBanner() {
  const [missing, setMissing] = useState<number>(0);
  const [pgNetOff, setPgNetOff] = useState(false);
  const [cronOff, setCronOff] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const results = await Promise.all(
        MARKERS.map(async (m) => {
          const { error } = await supabase.from(m.table).select(m.col, { head: true }).limit(1);
          return Boolean(error); // error = that migration's object is missing
        }),
      );
      // Are the Postgres extensions the notification/sync jobs need turned on?
      const { data: diag } = await supabase.rpc("telegram_diagnostics");
      if (!active) return;
      setMissing(results.filter(Boolean).length);
      if (diag) {
        setPgNetOff(!(diag as { pg_net_enabled?: boolean }).pg_net_enabled);
        setCronOff(!(diag as { pg_cron_enabled?: boolean }).pg_cron_enabled);
      }
      setChecked(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!checked) return null;

  if (missing > 0) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/[0.08] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f59e0b]/20 text-[#fbbf24]">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[#f0f0f5]">
            {missing} database update{missing === 1 ? "" : "s"} not applied yet
          </p>
          <p className="text-[12px] text-white/55">
            Some recent features won&apos;t work until you run the latest migrations. Open Supabase → SQL Editor and run{" "}
            <span className="font-medium text-white/80">apply_all_migrations.sql</span>, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  // Migrations are applied but the extensions that actually SEND notifications /
  // run reminders are off — the single most common reason Telegram stays silent.
  if (pgNetOff) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#f87171]/30 bg-[#f87171]/[0.1] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f87171]/20 text-[#f87171]">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[#f0f0f5]">Notifications &amp; reminders aren&apos;t being delivered</p>
          <p className="text-[12px] text-white/55">
            Enable the <span className="font-medium text-white/80">pg_net</span>
            {cronOff ? (
              <>
                {" "}and <span className="font-medium text-white/80">pg_cron</span>
              </>
            ) : null}{" "}
            extension{cronOff ? "s" : ""} in Supabase → Database → Extensions, then re-run{" "}
            <span className="font-medium text-white/80">apply_all_migrations.sql</span> and reload. (&ldquo;Send test&rdquo;
            works without them; real Telegram/email messages don&apos;t.)
          </p>
        </div>
      </div>
    );
  }

  return null;
}
