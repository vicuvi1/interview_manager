"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, Plus, RefreshCw, Star, Unplug, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

interface Account {
  id: string;
  email: string | null;
  enabled: boolean;
}
interface Calendar {
  id: string;
  account_id: string;
  summary: string | null;
  selected: boolean;
  is_push_target: boolean;
}
interface Diagnostics {
  pg_net_enabled: boolean;
  pg_cron_enabled: boolean;
  sync_scheduled: boolean;
  pending_jobs: number;
  failed_jobs: number;
  base_url_set: boolean;
  secret_set: boolean;
}
interface Status {
  configured: boolean;
  isAdmin: boolean;
  accounts: Account[];
  calendars: Calendar[];
  diagnostics: Diagnostics | null;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

function DiagRow({ ok, label, fix }: { ok: boolean; label: string; fix?: string }) {
  return (
    <li className="flex items-start gap-2 text-[12px]">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34d399]" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f87171]" />
      )}
      <span className="text-white/70">
        {label}
        {!ok && fix ? <span className="mt-0.5 block text-white/40">{fix}</span> : null}
      </span>
    </li>
  );
}

export function GoogleCalendarCard({ variant = "admin" }: { variant?: "admin" | "candidate" }) {
  const { toast } = useToast();
  const returnPath = variant === "candidate" ? "/candidate/settings" : "/admin/settings";
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/google", { cache: "no-store" });
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    refresh();
    // Surface the OAuth redirect result once.
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g === "connected") toast({ title: "Google account connected", variant: "success" });
    else if (g === "error") toast({ title: "Couldn't connect Google", description: "Please try again.", variant: "error" });
    if (g) {
      params.delete("google");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [refresh, toast]);

  async function act(key: string, action: string, payload: Record<string, unknown> = {}, okMsg?: string) {
    setBusy(key);
    const r = await call(action, payload);
    setBusy(null);
    if (r.error) return toast({ title: "Something went wrong", description: r.error, variant: "error" });
    if (okMsg) toast({ title: okMsg, variant: "success" });
    refresh();
  }

  async function syncNow() {
    setBusy("sync");
    const res = await fetch("/api/google/sync", { method: "POST" });
    const r = await res.json().catch(() => ({}));
    setBusy(null);
    if (r.error) return toast({ title: "Sync failed", description: r.error, variant: "error" });
    toast({ title: "Synced", description: `${r.pushed ?? 0} pushed · ${r.pulled ?? 0} pulled`, variant: "success" });
    refresh();
  }

  return (
    <SectionCard
      title="Google Calendar"
      description="Two-way sync: interviews you schedule appear on Google, and changes there flow back."
      icon={CalendarDays}
    >
      {status === null ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !status.configured ? (
        <p className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-[12px] text-white/45">
          Google Calendar isn&apos;t set up on the server yet. An admin needs to add the Google credentials — see
          docs/GOOGLE_CALENDAR_SETUP.md.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Connected accounts */}
          {status.accounts.length ? (
            <div className="space-y-2">
              {status.accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#34d399]" />
                  <span className="flex-1 truncate text-[13px] text-white/80">{a.email || "Google account"}</span>
                  {!a.enabled ? <span className="text-[11px] text-[#fbbf24]">needs reconnect</span> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => act(`refresh-${a.id}`, "refresh-calendars", { accountId: a.id }, "Calendars refreshed")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`Disconnect ${a.email || "this account"}?`))
                        act(`disc-${a.id}`, "disconnect-account", { accountId: a.id }, "Disconnected");
                    }}
                  >
                    <Unplug className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-white/55">
              Connect your Google account to sync interviews with your calendar. You can add more than one.
            </p>
          )}

          <a href={`/api/google/oauth/start?return=${encodeURIComponent(returnPath)}`}>
            <Button variant="secondary" size="sm" disabled={busy !== null}>
              <Plus className="h-4 w-4" /> Connect {status.accounts.length ? "another " : ""}Google account
            </Button>
          </a>

          {/* Calendars: choose which to sync + one push target */}
          {status.calendars.length ? (
            <div className="space-y-2 rounded-lg bg-white/[0.03] px-3.5 py-3">
              <p className="text-[12px] font-medium text-white/60">Your calendars</p>
              <p className="text-[11px] text-white/40">
                Tick the calendars to watch for changes, and pick the one ⭐ where new interview events are created.
              </p>
              {status.calendars.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-[13px] text-white/80">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      disabled={busy !== null}
                      onChange={(e) => act(`sel-${c.id}`, "toggle-selected", { calendarId: c.id, selected: e.target.checked })}
                      className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                    />
                    <span className="truncate">{c.summary || "Calendar"}</span>
                  </label>
                  <button
                    type="button"
                    disabled={busy !== null}
                    title={c.is_push_target ? "Push target" : "Make push target"}
                    onClick={() => act(`tgt-${c.id}`, "set-push-target", { calendarId: c.id }, "Push target set")}
                    className={
                      c.is_push_target
                        ? "inline-flex items-center gap-1 rounded-md bg-[#6366f1]/[0.18] px-2 py-1 text-[11px] font-medium text-[#c7d2fe]"
                        : "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                    }
                  >
                    <Star className={c.is_push_target ? "h-3.5 w-3.5 fill-current" : "h-3.5 w-3.5"} />
                    {c.is_push_target ? "Target" : "Set"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={busy === "sync"} disabled={busy !== null} onClick={syncNow}>
              <RefreshCw className="h-4 w-4" /> Sync now
            </Button>
            {status.isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy === "cfg"}
                disabled={busy !== null}
                onClick={() => act("cfg", "init-sync-config", {}, "Server sync enabled")}
              >
                Enable server sync
              </Button>
            ) : null}
          </div>

          {/* Admin diagnostics */}
          {status.isAdmin && status.diagnostics ? (
            <ul className="space-y-1.5 rounded-lg bg-white/[0.03] px-3.5 py-3">
              <DiagRow ok={status.diagnostics.base_url_set && status.diagnostics.secret_set} label="Server sync configured" fix="Click “Enable server sync”." />
              <DiagRow ok={status.diagnostics.pg_net_enabled} label="pg_net extension enabled" fix="Supabase → Database → Extensions → enable pg_net." />
              <DiagRow ok={status.diagnostics.pg_cron_enabled && status.diagnostics.sync_scheduled} label="Automatic sync scheduled (every minute)" fix="Enable pg_cron and re-run apply_all_migrations.sql." />
              {status.diagnostics.failed_jobs > 0 ? (
                <li className="text-[12px] text-[#fbbf24]">{status.diagnostics.failed_jobs} job(s) gave up after retries — check a connected account.</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
