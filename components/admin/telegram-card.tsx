"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCircle2, Loader2, Send, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

interface Status {
  hasToken: boolean;
  botUsername: string | null;
  connected: boolean;
  reminderMinutes: number;
  enabled: boolean;
}

const MINUTES = [5, 10, 15, 20, 30, 45, 60];

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

export function TelegramCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/telegram", { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    setMinutes(s.reminderMinutes);
    setEnabled(s.enabled);
  }

  useEffect(() => {
    refreshStatus();
  }, []);

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
    const r = await call("update", { reminderMinutes: minutes, enabled });
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

  async function disconnect() {
    if (!window.confirm("Disconnect Telegram reminders?")) return;
    setBusy("disconnect");
    const r = await call("disconnect");
    setBusy(null);
    if (r.error) return toast({ title: "Error", description: r.error, variant: "error" });
    toast({ title: "Disconnected", variant: "success" });
    refreshStatus();
  }

  return (
    <SectionCard title="Telegram reminders" description="Get pinged before each interview." icon={Bell}>
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
          <div className="flex items-center gap-2 text-[13px]">
            <Badge tone="amber">action needed</Badge>
            <span className="text-white/70">
              {status.botUsername ? `@${status.botUsername}` : "Your bot"} is added — send it{" "}
              <span className="text-white/90">/start</span> in Telegram, then detect the chat.
            </span>
          </div>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Remind me before" htmlFor="tg-minutes">
              <Select id="tg-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes before
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
                />
                Reminders enabled
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "save"} disabled={busy !== null} onClick={save}>
              Save
            </Button>
            <Button variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={test}>
              <Send className="h-4 w-4" /> Send test
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={disconnect}>
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          </div>

          <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/40">
            Reminders fire once the scheduled job is enabled in Supabase (see the setup notes). Times use your profile timezone.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
