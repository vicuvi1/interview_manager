"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HeartPulse, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Status = "ok" | "missing" | "unknown" | "checking";

const DUMMY_ID = "00000000-0000-0000-0000-000000000000";

async function checkColumn(table: string, column: string): Promise<Status> {
  const supabase = createClient();
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return "ok";
  const m = error.message.toLowerCase();
  if (m.includes("does not exist") || m.includes("could not find") || m.includes("column")) return "missing";
  return "unknown";
}

async function checkRpc(fn: string, args: Record<string, unknown>): Promise<Status> {
  const supabase = createClient();
  const { error } = await supabase.rpc(fn, args);
  if (!error) return "ok";
  const m = error.message.toLowerCase();
  if (m.includes("could not find") || m.includes("does not exist")) return "missing";
  // A validation/domain error raised inside the function (e.g. "Interview not
  // found", "Not authorized") means the function EXISTS → applied.
  if (m.includes("not found") || m.includes("not authorized") || m.includes("invalid") || error.code === "P0001") return "ok";
  // Anything else (permission, network, unexpected) — don't claim it's applied.
  return "unknown";
}

interface Check {
  key: string;
  label: string;
  migration: string;
  run: () => Promise<Status>;
}

const CHECKS: Check[] = [
  { key: "durations", label: "Configurable durations", migration: "0063", run: () => checkColumn("app_settings", "duration_options") },
  { key: "status", label: "Status customization", migration: "0064", run: () => checkColumn("app_settings", "status_labels") },
  { key: "editfields", label: "Candidate edit: type & duration", migration: "0065", run: () => checkRpc("edit_my_interview", { p_interview_id: DUMMY_ID, p_interview_type: null, p_duration: null }) },
  { key: "materials", label: "Per-interview materials snapshot", migration: "0067", run: () => checkColumn("interview_requests", "resume_path") },
  { key: "sent", label: "Meeting-details “sent” stamp", migration: "0067", run: () => checkColumn("interview_requests", "details_sent_at") },
  { key: "icsfn", label: "Calendar .ics feed function", migration: "0068", run: () => checkRpc("ics_feed", { p_token: "schema-health-probe-000000" }) },
  { key: "icstoken", label: "Calendar feed token column", migration: "0068", run: () => checkColumn("profiles", "ics_token") },
  { key: "company", label: "Company name on requests", migration: "0070", run: () => checkColumn("interview_requests", "company") },
  { key: "interviewer_name", label: "Editable interviewer name + full edit", migration: "0071", run: () => checkColumn("interview_requests", "interviewer_name") },
];

export function SchemaHealthCard() {
  const [results, setResults] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults(Object.fromEntries(CHECKS.map((c) => [c.key, "checking" as Status])));
    const entries = await Promise.all(CHECKS.map(async (c) => [c.key, await c.run()] as const));
    setResults(Object.fromEntries(entries));
    setRunning(false);
  }, []);

  useEffect(() => {
    runAll();
  }, [runAll]);

  const missing = CHECKS.filter((c) => results[c.key] === "missing");

  return (
    <SectionCard
      title="Database health"
      description="Checks that recent migrations are applied to your Supabase database."
      icon={HeartPulse}
      action={
        <Button size="sm" variant="secondary" onClick={runAll} loading={running} disabled={running}>
          <RefreshCw className="h-4 w-4" /> Re-check
        </Button>
      }
    >
      <div className="space-y-2">
        {missing.length > 0 ? (
          <p className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/[0.08] px-3 py-2 text-[12px] text-[#fbbf24]">
            {missing.length} migration{missing.length === 1 ? "" : "s"} not applied. Run{" "}
            <span className="font-mono">npm run db:push</span> (or paste the file in the Supabase SQL editor).
          </p>
        ) : null}
        <ul className="divide-y divide-white/[0.06]">
          {CHECKS.map((c) => {
            const s = results[c.key] ?? "checking";
            return (
              <li key={c.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="flex items-center gap-2 text-white/75">
                  {s === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-[#34d399]" />
                  ) : s === "missing" ? (
                    <XCircle className="h-4 w-4 text-[#f87171]" />
                  ) : s === "unknown" ? (
                    <AlertTriangle className="h-4 w-4 text-[#fbbf24]" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                  )}
                  {c.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-white/35">{c.migration}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}
