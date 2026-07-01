"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Database, FileText, HardDrive, Loader2, RefreshCw, Table2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn, formatBytes } from "@/lib/utils";

// Supabase free-tier ceilings (approx) — used only for the usage bars/warnings.
const FREE_DB_BYTES = 500 * 1024 * 1024; // 500 MB Postgres
const FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GB files

interface Retention {
  retention_enabled: boolean;
  notifications_days: number;
  audit_days: number;
  reminder_days: number;
  closed_requests_days: number;
}

interface TableStat {
  name: string;
  rows: number;
  bytes: number;
}
interface Stats {
  db_bytes: number;
  tables: TableStat[];
  storage_bytes: number;
  storage_files: number;
}

const CLEANUPS = [
  { target: "read_notifications", label: "Read notifications", icon: Bell, detail: "Delivered and already-read notifications." },
  { target: "audit_log", label: "Activity log entries", icon: Table2, detail: "Old rows from the admin activity log." },
  { target: "reminder_log", label: "Sent reminder records", icon: RefreshCw, detail: "Bookkeeping for Telegram reminders already sent." },
  { target: "closed_requests", label: "Cancelled / declined requests", icon: Trash2, detail: "Requests that were cancelled or rejected." },
];

const DAY_OPTIONS = [
  { value: 0, label: "any age" },
  { value: 7, label: "older than 7 days" },
  { value: 30, label: "older than 30 days" },
  { value: 90, label: "older than 90 days" },
  { value: 365, label: "older than 1 year" },
];

export function StorageBoard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data, error }, { data: cfg }] = await Promise.all([
      supabase.rpc("get_storage_stats"),
      supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (error) toast({ title: "Couldn't load usage", description: error.message, variant: "error" });
    else setStats(data as Stats);
    if (cfg) setRetention(cfg as Retention);
    setLoading(false);
  }, [toast]);

  async function saveRetention(patch: Partial<Retention>) {
    if (!retention) return;
    const next = { ...retention, ...patch };
    setRetention(next);
    setBusy("retention");
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(null);
    if (error) toast({ title: "Couldn't save", description: error.message, variant: "error" });
  }

  async function runRetention() {
    setBusy("run");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("run_retention");
    setBusy(null);
    if (error) return toast({ title: "Cleanup failed", description: error.message, variant: "error" });
    toast({ title: `Removed ${data ?? 0} row${data === 1 ? "" : "s"}`, variant: "success" });
    load();
  }

  useEffect(() => {
    load();
  }, [load]);

  const maxBytes = useMemo(() => Math.max(1, ...(stats?.tables ?? []).map((t) => t.bytes)), [stats]);

  async function cleanup(target: string, label: string) {
    if (!window.confirm(`Delete ${label.toLowerCase()} (${DAY_OPTIONS.find((d) => d.value === days)?.label})? This can't be undone.`))
      return;
    setBusy(target);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("cleanup_data", { p_target: target, p_older_than_days: days });
    setBusy(null);
    if (error) return toast({ title: "Cleanup failed", description: error.message, variant: "error" });
    toast({ title: `Removed ${data ?? 0} row${data === 1 ? "" : "s"}`, variant: "success" });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Storage &amp; data</h1>
          <p className="text-[12px] text-white/40">See what&apos;s using space and clean up old data.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading usage…
        </div>
      ) : !stats ? (
        <SectionCard title="Usage" icon={Database}>
          <EmptyState icon={Database} title="No data" description="Couldn't read storage stats." />
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Database size" value={formatBytes(stats.db_bytes)} icon={Database} tone="indigo" />
            <StatCard label="Résumé files" value={formatBytes(stats.storage_bytes)} icon={HardDrive} tone="blue" />
            <StatCard label="Files stored" value={stats.storage_files} icon={FileText} tone="slate" />
            <StatCard label="Tables" value={stats.tables.length} icon={Table2} tone="slate" />
          </div>

          <SectionCard title="Free-tier usage" description="Against the Supabase free-plan limits." icon={Database}>
            <div className="space-y-4">
              <QuotaBar label="Database" used={stats.db_bytes} limit={FREE_DB_BYTES} />
              <QuotaBar label="File storage" used={stats.storage_bytes} limit={FREE_STORAGE_BYTES} />
            </div>
          </SectionCard>

          <SectionCard title="By table" description="Total size on disk (index + data)." icon={Table2}>
            {stats.tables.length === 0 ? (
              <EmptyState icon={Table2} title="No tables" />
            ) : (
              <div className="space-y-2.5">
                {stats.tables.slice(0, 14).map((t) => (
                  <div key={t.name} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate font-mono text-[12px] text-white/60">{t.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]"
                        style={{ width: `${(t.bytes / maxBytes) * 100}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-white/40">~{t.rows}</span>
                    <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-white/80">{formatBytes(t.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Free up space"
            description="Delete old records you no longer need."
            icon={Trash2}
            action={
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 w-44">
                {DAY_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            }
            bodyClassName="p-0 sm:p-0"
          >
            <ul className="divide-y divide-white/[0.06]">
              {CLEANUPS.map((c) => {
                const Icon = c.icon;
                return (
                  <li key={c.target} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/50">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[#f0f0f5]">{c.label}</p>
                      <p className="text-[12px] text-white/45">{c.detail}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === c.target}
                      disabled={busy !== null}
                      onClick={() => cleanup(c.target, c.label)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          {retention ? (
            <SectionCard
              title="Automatic cleanup"
              description="Trim old data on a schedule so you stay under the limits."
              icon={RefreshCw}
              action={
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white/70">
                  <input
                    type="checkbox"
                    checked={retention.retention_enabled}
                    onChange={(e) => saveRetention({ retention_enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                  />
                  Enabled
                </label>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <DayField label="Read notifications" value={retention.notifications_days} onSave={(v) => saveRetention({ notifications_days: v })} />
                <DayField label="Activity log" value={retention.audit_days} onSave={(v) => saveRetention({ audit_days: v })} />
                <DayField label="Reminder records" value={retention.reminder_days} onSave={(v) => saveRetention({ reminder_days: v })} />
                <DayField label="Cancelled / declined requests" value={retention.closed_requests_days} onSave={(v) => saveRetention({ closed_requests_days: v })} />
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Button size="sm" variant="secondary" loading={busy === "run"} disabled={busy !== null} onClick={runRetention}>
                  <RefreshCw className="h-4 w-4" /> Run now
                </Button>
                <p className="text-[12px] text-white/40">
                  {retention.retention_enabled ? "Runs daily once scheduled in Supabase (pg_cron)." : "Enable, then schedule the daily job in Supabase."}
                </p>
              </div>
            </SectionCard>
          ) : null}

          <p className="px-1 text-[12px] text-white/35">
            Row counts drop immediately; on-disk size is reclaimed by Postgres autovacuum shortly after. Uploaded résumés are
            managed by each candidate under their profile.
          </p>
        </>
      )}
    </div>
  );
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 90 ? "#f87171" : pct >= 70 ? "#fbbf24" : "#6366f1";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-white/70">{label}</span>
        <span className="tabular-nums text-white/50">
          {formatBytes(used)} / {formatBytes(limit)} · {pct}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(1, pct)}%`, backgroundColor: tone }} />
      </div>
      {pct >= 90 ? (
        <p className="mt-1 text-[11px] text-[#f87171]">Almost full — clean up or upgrade soon.</p>
      ) : pct >= 70 ? (
        <p className="mt-1 text-[11px] text-[#fbbf24]">Getting full — consider cleaning up old data.</p>
      ) : null}
    </div>
  );
}

function DayField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  return (
    <Field label={`${label} — keep (days)`} htmlFor={`day-${label}`}>
      <Input
        id={`day-${label}`}
        type="number"
        min={1}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const v = Math.max(1, Number(local) || value);
          setLocal(String(v));
          if (v !== value) onSave(v);
        }}
      />
    </Field>
  );
}
