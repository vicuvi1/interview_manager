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
      if (!active) return;
      setMissing(results.filter(Boolean).length);
      setChecked(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!checked || missing === 0) return null;

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
