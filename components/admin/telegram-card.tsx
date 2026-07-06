"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, Loader2, Send, Stethoscope, Unplug, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface Status {
  hasToken: boolean;
  botUsername: string | null;
  connected: boolean;
  reminderMinutes: number;
  enabled: boolean;
  commandsEnabled: boolean;
}

interface Diag {
  pg_net_enabled: boolean;
  pg_cron_enabled: boolean;
  forward_trigger: boolean;
  reminders_scheduled: boolean;
  has_settings: boolean;
  enabled: boolean;
  has_token: boolean;
  has_chat: boolean;
  bot_username: string | null;
}

const MINUTES = [5, 10, 15, 20, 30, 45, 60];

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

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

export function TelegramCard({ variant = "admin" }: { variant?: "admin" | "candidate" }) {
  const isCandidate = variant === "candidate";
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/telegram", { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    setMinutes(s.reminderMinutes);
    setEnabled(s.enabled);
  }

  useEffect(() => {
    refreshStatus();
    // Auto-run diagnostics so a broken delivery path (pg_net off, trigger
    // missing) is visible immediately — not only after clicking the button.
    (async () => {
      const r = await call("diagnose");
      if (!r.error && r.diagnostics) setDiag(r.diagnostics as Diag);
    })();
  }, []);

  // Connected + something in the DB→Telegram path is broken (why "test works but
  // real notifications don't").
  const deliveryBroken = Boolean(status?.connected && diag && (!diag.pg_net_enabled || !diag.forward_trigger));

  async function connect() {
    if (!token.trim()) return;
    setBusy("connect");
    const r = await call("connect", { token: token.trim() });
    setBusy(null);
    if (r.error) return toast({ title: "Couldn't connect", description: r.error, variant: "error" });
    setToken("");
    toast({
      title: r.connected ? "Bot connected" : `@${r.botUsername} added`,
      description: r.connected ? undefined : "Now send /start to it in Telegram, then Detect chat.",
      variant: "success",
    });
    refreshStatus();
  }

  async function detect() {
    setBusy("detect");
    const r = await call("refresh");
    setBusy(null);
    if (r.error) return toast({ title: "Error", description: r.error, variant: "error" });
    if (!r.connected) return toast({ title: "No chat found yet", description: r.hint, variant: "info" });
    toast({ title: "Chat detected", variant: "success" });
    refreshStatus();
  }

  async function save() {
    setBusy("save");
    const r = await call("update", { reminderMinutes: isCandidate ? undefined : minutes, enabled });
    setBusy(null);
    if (r.error) return toast({ title: "Couldn't save", description: r.error, variant: "error" });
    toast({ title: "Preferences saved", variant: "success" });
    refreshStatus();
  }

  async function test() {
    setBusy("test");
    const r = await call("test");
    setBusy(null);
    if (r.error) return toast({ title: "Test failed", description: r.error, variant: "error" });
    toast({ title: "Test message sent", description: "Check Telegram.", variant: "success" });
  }

  // End-to-end: creates a real notification (bell + Telegram-forward + email).
  async function testPipeline() {
    setBusy("pipeline");
    const supabase = createClient();
    const { error } = await supabase.rpc("send_self_test_notification");
    setBusy(null);
    if (error) return toast({ title: "Couldn't send", description: error.message, variant: "error" });
    toast({
      title: "Test notification sent",
      description: "Check your Telegram and the in-app bell.",
      variant: "success",
    });
  }

  async function diagnose() {
    setBusy("diagnose");
    const r = await call("diagnose");
    setBusy(null);
    if (r.error) {
      // A "function ... does not exist" error means the latest migration hasn't
      // been applied yet — surface that plainly.
      return toast({
        title: "Couldn't run diagnostics",
        description: /telegram_diagnostics/i.test(String(r.error))
          ? "Run apply_all_migrations.sql in Supabase → SQL editor, then try again."
          : r.error,
        variant: "error",
      });
    }
    setDiag(r.diagnostics as Diag);
  }

  async function toggleCommands() {
    const turnOn = !status?.commandsEnabled;
    setBusy("commands");
    const r = await call(turnOn ? "enable-commands" : "disable-commands");
    setBusy(null);
    if (r.error) return toast({ title: "Couldn't update commands", description: r.error, variant: "error" });
    toast({ title: turnOn ? "Commands enabled" : "Commands disabled", variant: "success" });
    refreshStatus();
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Telegram?")) return;
    setBusy("disconnect");
    const r = await call("disconnect");
    setBusy(null);
    if (r.error) return toast({ title: "Error", description: r.error, variant: "error" });
    toast({ title: "Disconnected", variant: "success" });
    refreshStatus();
  }

  return (
    <SectionCard
      title="Telegram notifications"
      description={isCandidate ? "Get interview updates in Telegram." : "Interview updates + reminders in Telegram."}
      icon={Bell}
    >
      {status === null ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !status.hasToken ? (
        <div className="space-y-4">
          <ol className="space-y-1.5 text-[12px] text-white/55">
            <li>
              1. In Telegram, open <span className="text-white/80">@BotFather</span> → <span className="text-white/80">/newbot</span> and copy the token.
            </li>
            <li>2. Send <span className="text-white/80">/start</span> to your new bot so it can message you.</li>
            <li>3. Paste the token below and connect.</li>
          </ol>
          <Field label="Bot token" htmlFor="tg-token">
            <Input
              id="tg-token"
              placeholder="123456:ABC-DEF…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button loading={busy === "connect"} disabled={!token.trim() || busy !== null} onClick={connect}>
            Connect bot
          </Button>
        </div>
      ) : !status.connected ? (
        <div className="space-y-4">
          <p className="text-[13px] font-medium text-white/80">Almost done — 2 quick steps in Telegram:</p>
          <ol className="space-y-1.5 text-[12px] text-white/60">
            <li>
              1. Open Telegram, search for {status.botUsername ? <span className="font-medium text-white/85">@{status.botUsername}</span> : "your bot"}, open the chat, and tap{" "}
              <span className="font-medium text-white/85">Start</span> (or type <span className="font-medium text-white/85">/start</span>).
            </li>
            <li>2. Come back here and tap <span className="font-medium text-white/85">Detect chat</span> below.</li>
          </ol>
          <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] text-white/40">
            &ldquo;Action needed&rdquo; just means we don&apos;t know your Telegram chat yet. Tapping Start lets the bot message you, and Detect chat links it.
          </p>
          <div className="flex gap-2">
            <Button loading={busy === "detect"} disabled={busy !== null} onClick={detect}>
              Detect chat
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={disconnect}>
              <Unplug className="h-4 w-4" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-white/70">
            <CheckCircle2 className="h-4 w-4 text-[#34d399]" />
            Connected{status.botUsername ? ` to @${status.botUsername}` : ""}.
          </div>

          {deliveryBroken ? (
            <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/[0.1] px-3.5 py-3 text-[12px] text-[#fca5a5]">
              <p className="font-semibold text-[#f87171]">Real notifications aren&apos;t being delivered.</p>
              <p className="mt-1 text-white/70">
                &ldquo;Send test&rdquo; works because it sends from the web server, but confirmations &amp; reminders are
                sent from the database — which needs{" "}
                {!diag?.pg_net_enabled ? (
                  <>
                    the <span className="font-medium text-white/90">pg_net</span> extension enabled (Supabase → Database →
                    Extensions).
                  </>
                ) : (
                  <>
                    the forwarding trigger installed — re-run{" "}
                    <span className="font-medium text-white/90">apply_all_migrations.sql</span>.
                  </>
                )}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {!isCandidate ? (
              <Field label="Remind me before" htmlFor="tg-minutes">
                <Select id="tg-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes before
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                />
                Notifications enabled
              </label>
            </div>
          </div>

          <div className="rounded-lg bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white/80">
                  Two-way commands {status.commandsEnabled ? <span className="text-[#34d399]">· on</span> : null}
                </p>
                <p className="text-[12px] text-white/45">
                  Reply in Telegram: <span className="text-white/70">/next</span>,{" "}
                  <span className="text-white/70">/interviews</span>
                  {isCandidate ? <>, <span className="text-white/70">/pay</span></> : null},{" "}
                  <span className="text-white/70">/help</span>.
                </p>
              </div>
              <Button
                variant={status.commandsEnabled ? "ghost" : "secondary"}
                size="sm"
                loading={busy === "commands"}
                disabled={busy !== null}
                onClick={toggleCommands}
              >
                {status.commandsEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "save"} disabled={busy !== null} onClick={save}>
              Save
            </Button>
            <Button variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={test}>
              <Send className="h-4 w-4" /> Send test
            </Button>
            <Button variant="secondary" loading={busy === "pipeline"} disabled={busy !== null} onClick={testPipeline}>
              <BellRing className="h-4 w-4" /> Test a notification
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={disconnect}>
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          </div>
          <p className="text-[11px] text-white/40">
            <span className="text-white/60">Send test</span> checks the bot connection.{" "}
            <span className="text-white/60">Test a notification</span> fires a real notification through the whole
            pipeline — if it reaches Telegram, everything works.
          </p>

          <div className="rounded-lg bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white/80">Delivery health</p>
                <p className="text-[12px] text-white/45">
                  Real notifications forward from the database — this checks that pipeline.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === "diagnose"}
                disabled={busy !== null}
                onClick={diagnose}
              >
                <Stethoscope className="h-4 w-4" /> Run diagnostics
              </Button>
            </div>
            {diag ? (
              <ul className="mt-3 space-y-1.5">
                <DiagRow
                  ok={diag.forward_trigger}
                  label="Telegram forwarding installed"
                  fix="Run apply_all_migrations.sql in Supabase → SQL editor."
                />
                <DiagRow
                  ok={diag.pg_net_enabled}
                  label="pg_net extension enabled (lets the database message Telegram)"
                  fix="Supabase → Database → Extensions → enable pg_net."
                />
                <DiagRow
                  ok={diag.has_token && diag.has_chat}
                  label="Bot connected to a chat"
                  fix="Send /start to your bot in Telegram, then tap Detect chat."
                />
                <DiagRow
                  ok={diag.enabled}
                  label="Notifications enabled"
                  fix="Tick “Notifications enabled” above and Save."
                />
                {!isCandidate ? (
                  <DiagRow
                    ok={diag.pg_cron_enabled && diag.reminders_scheduled}
                    label="Interview reminders scheduled"
                    fix="Enable pg_cron and schedule the job — see docs/TELEGRAM_SETUP.md."
                  />
                ) : null}
              </ul>
            ) : null}
          </div>

          <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/40">
            {isCandidate
              ? "You'll get a Telegram message whenever your interview is approved, rescheduled, declined, or updated."
              : "You'll get every notification here, plus interview reminders once the scheduled job is enabled in Supabase."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
